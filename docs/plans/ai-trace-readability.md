# AI Trace Readability

Two additions that make trace zips directly consumable by LLMs and AI agents:

1. **`transcript.md`** inside the zip — ordered action log, zero parsing required
2. **`snapshot-*.txt`** per screenshot — hierarchical element tree with selectors and inferred purpose

---

## Background

The current trace zip contains:
- `trace.trace` — NDJSON (needs parsing)
- `trace.network` — HAR NDJSON
- `resources/page@*.jpeg` — screenshots (binary)
- `resources/elements-*.json` — flat element arrays (structured but dense)

An LLM can only use these after extraction and parsing. The two additions below make the trace useful by extracting a single text file and a per-frame human-readable snapshot.

---

## Feature 1 — `transcript.md`

### What

A Markdown file written to the zip at `stop()` time, synthesised from the already-collected `session.events`. Contains every action in order: title, selector (if any), duration, pass/fail.

### Format

```markdown
# chrome — 2026-05-20T12:00:00.000Z

1. Page.navigate("https://example.com/login")  123ms
2. Element.click("button*=Accept cookies")  button*=Accept cookies  45ms
3. Element.fill("Email address")  #email  12ms  value="user@..."
4. Element.click("Sign in")  button*=Sign in  890ms  ERROR: element not interactable
```

Rules:
- One line per `before`/`after` pair, ordered by `startTime`
- Duration = `endTime - startTime` (ms)
- Selector printed when present in `params.selector`
- `value` printed for fill/setValue/selectByVisibleText
- `ERROR: <message>` appended when `after.error` is set
- Headers: `# <title> — <ISO walltime>`

### Implementation

`buildTraceZip` receives the events and already has everything needed. Add a `generateTranscript(session: TraceSession): string` function in `zip-writer.ts` (or a new `transcript.ts`) and call `zipFile.addBuffer(Buffer.from(md, 'utf8'), 'transcript.md')` before `zipFile.end()`.

No new data collection required — pure post-processing.

---

## Feature 2 — `snapshot-*.txt` (hierarchical element tree)

### What

One text file per screenshot frame. A depth-indented tree of visible elements — containers as structure, interactive elements as leaves with `→ selector`. Unlabeled elements show their nearest named ancestor as purpose context (`∈ "ancestor text"`).

### Target format

**Web:**
```
[Page: Login — https://example.com/login]
  navigation "Main"
    link "Home"  →  a*=Home
    link "Products"  →  a[href="/products"]
  main
    heading[1] "Sign in to your account"
    form "Login"
      textbox "Email address"  →  #email
      textbox "Password"  →  input[name=password]
      checkbox ∈ "Keep me signed in"  →  #remember   ← purpose from parent label text
      button "Sign in"  →  button*=Sign in
      link "Forgot password?"  →  a*=Forgot password?
```

**Mobile (Android):**
```
[android — Pixel 7 (412×915)]
  FrameLayout
    LinearLayout "Onboarding"
      Button "Skip"  →  accessibility-id:Skip
      Button "Accept All Cookies"  →  accessibility-id:Accept All Cookies
    ScrollView
      EditText ∈ "Search books…"  →  id:uk.co.brightec.ziffit.dev:id/search  ← contentDesc on parent
      Button "Account"  →  accessibility-id:Account
```

`∈` means: element has no self-name; nearest named ancestor provides the purpose context.

### Data sources

| Platform | Hierarchy source | Selector source |
|---|---|---|
| Web | `AccessibilityNode[]` with emitted `depth` | `getSelector()` already in each node |
| Android/iOS | `JSONElement` tree (already recursive via `translateRecursively`) | `generateAllElementLocators` per leaf |

Both sources already exist. The changes are additive.

---

## Required changes

### 1. `packages/elements/src/accessibility-tree.ts` — emit depth

`AccessibilityNode` gains `depth: number`. The `walk()` function already receives `depth`; one line adds it to the output node.

```ts
// AccessibilityNode interface
depth: number  // ADD

// inside walk():
const node: RawNode = {
  role, name, selector,
  depth,          // ADD
  level: getLevel(el) ?? '',
  ...getState(el)
}
```

This is the only change needed to the a11y tree. No new DOM walk.

### 2. `packages/elements/src/snapshot.ts` — new file

Two public functions:

```ts
export function serializeWebSnapshot(
  nodes: AccessibilityNode[],
  context?: { url?: string; title?: string }
): string

export function serializeMobileSnapshot(
  root: JSONElement,
  context?: { deviceName?: string; platform: 'android' | 'ios'; viewport?: { width: number; height: number } }
): string
```

#### `serializeWebSnapshot` algorithm

```
header: [Page: <title> — <url>]
for each node in nodes (ordered, depth preserved):
  indent = '  '.repeat(node.depth)
  label = node.name || inferPurpose(nodes, index)
  isInteractive = INTERACTIVE_ROLES.has(node.role)
  
  if isInteractive and label is from ancestor:
    line = `${indent}${node.role} ∈ "${label}"  →  ${node.selector}`
  else if isInteractive:
    line = `${indent}${node.role} "${label}"  →  ${node.selector}`
  else:
    line = `${indent}${node.role}${label ? ' "' + label + '"' : ''}`
    (container — no selector)
```

Purpose inference:
```ts
function inferPurpose(nodes: AccessibilityNode[], index: number): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth < myDepth && nodes[i].name) {
      return nodes[i].name
    }
  }
  return undefined
}
```

INTERACTIVE_ROLES = `button | link | textbox | checkbox | radio | combobox | slider | searchbox | spinbutton | switch | tab | menuitem | option`

#### `serializeMobileSnapshot` algorithm

Walk the `JSONElement` tree recursively (it already has `children`). At each node:
- Extract: `text`, `content-desc` (Android) / `label` + `name` (iOS), `resource-id`, tag name
- Interactive = `clickable="true"` || tag in `{Button, EditText, CheckBox, Switch, ...}`
- If interactive and has identity: `Button "Skip"  →  <best locator>`
- If interactive and no identity: look at parent's `text`/`content-desc` for `∈` context
- Container: just tag + text if any (no selector)

The best locator per leaf is derived by calling `generateAllElementLocators` with a single-element XML fragment, or (cheaper) by inlining the locator priority logic for the single node.

### 3. `packages/elements/src/index.ts` — export new functions

```ts
export { serializeWebSnapshot, serializeMobileSnapshot } from './snapshot.js'
export type { JSONElement } from './locators/types.js'  // needed by caller
```

Also expose `getBrowserAccessibilityTree` if not already exported (currently it is).

### 4. `packages/tracing/src/types.ts`

```ts
export interface ElementSnapshot {
  resourceName: string
  data: Buffer
  snapshotText?: string   // ADD — the .txt snapshot, stored alongside JSON
}

// screencast-frame event:
export interface ScreencastFrameEvent {
  // ...existing...
  elements?: string   // already present
  snapshot?: string   // ADD — resource name of snapshot-*.txt
}
```

### 5. `packages/tracing/src/state.ts`

No change needed if `snapshotText` is stored on `ElementSnapshot` directly.

### 6. `packages/tracing/src/recorder.ts` — `#captureElements`

```ts
async #captureElements(wallTimestamp: number): Promise<{ elementsName: string; snapshotName: string | undefined } | undefined> {
  try {
    const result = await this.#runInternal(() =>
      getElements(this.#browser, { inViewportOnly: true, includeBounds: true })
    ) as VisibleElementsResult

    const elementsResourceName = `elements-${this.#session.pageId}-${wallTimestamp}.json`
    const data = Buffer.from(JSON.stringify(result.elements), 'utf8')

    // Generate snapshot text
    let snapshotName: string | undefined
    try {
      const snapshotText = this.#session.sessionType === 'browser'
        ? serializeWebSnapshot(await getBrowserAccessibilityTree(this.#browser), { url: ... })
        : serializeMobileSnapshot(result.tree, { platform: this.#session.sessionType, ... })
      snapshotName = `snapshot-${this.#session.pageId}-${wallTimestamp}.txt`
      this.#session.elementSnapshots.push({
        resourceName: elementsResourceName,
        data,
        snapshotText
      })
    } catch {
      this.#session.elementSnapshots.push({ resourceName: elementsResourceName, data })
    }

    return { elementsName: elementsResourceName, snapshotName }
  } catch {
    return undefined
  }
}
```

Note: `serializeMobileSnapshot` needs the `JSONElement` tree, not just the flat `MobileElementInfo[]`. `getElements` currently returns the flat version. Two options:
- **Option A**: extend `VisibleElementsResult` to include `tree?: JSONElement` for mobile
- **Option B**: call `getPageSource` again inside `#captureElements` (extra HTTP call — bad)
- **Option A is correct**. `getMobileVisibleElements` already parses the XML to `JSONElement` internally; expose the root as `result.tree` for mobile sessions.

### 7. `packages/tracing/src/zip-writer.ts`

```ts
// Add transcript.md
const transcript = generateTranscript(session)
zipFile.addBuffer(Buffer.from(transcript, 'utf8'), 'transcript.md')

// Add snapshot text files alongside element JSON
for (const snapshot of session.elementSnapshots) {
  zipFile.addBuffer(snapshot.data, `resources/${snapshot.resourceName}`)
  if (snapshot.snapshotText) {
    const snapshotName = snapshot.resourceName.replace('.json', '.txt').replace('elements-', 'snapshot-')
    zipFile.addBuffer(Buffer.from(snapshot.snapshotText, 'utf8'), `resources/${snapshotName}`)
  }
}
```

---

## Scope boundary

`generateTranscript` is pure post-processing (no new session data). `serializeWebSnapshot` requires one extra `getBrowserAccessibilityTree` call per screenshot — that's a second `browser.execute()` alongside the existing `getElements` call. For mobile, the tree is free (derived from the same `getPageSource` already being parsed).

The extra `getBrowserAccessibilityTree` for web sessions doubles the browser.execute calls inside `#captureElements`. Both are guarded by `#internalCommandDepth`, so no recursion risk. Worth measuring whether it adds noticeable latency.

---

## What this does NOT change

- Trace zip structure — all existing files stay in place
- `getElements` flat output — `elements-*.json` stays as-is (used by the Vibium player)
- Network tracing, action events, screenshot capture — untouched
- Mobile spec / service / standalone API — no interface changes
