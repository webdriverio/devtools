# @wdio/elements

Element detection and locator generation for WebdriverIO — browser DOM querying, mobile page-source parsing, accessibility tree extraction, and AI-readable snapshots.

## Install

```bash
npm install @wdio/elements
```

Peer dependency: `webdriverio` `^9.0.0 || ^10.0.0`.

## Usage

### Unified entry point (auto-detects browser vs mobile)

```ts
import { getElements } from '@wdio/elements'

const result = await getElements(browser, { limit: 50, inViewportOnly: true })
// { total, showing, hasMore, elements, tree? }
```

### Accessibility snapshot (`getSnapshot`)

Returns the accessibility tree as text: each actionable element gets an `eN` ref, and on the snapshot renderer its line ends in `→ <selector>`. The installed `webdriverio` picks the renderer:

- **Below 10.2** (9.x, 10.0, 10.1): the legacy renderer, which keeps this package's previous output.
- **10.2 and later, prereleases included** (`10.2.0-alpha.*`): `@wdio/snapshot`, the renderer behind `wdio session snapshot --selectors`. On WebdriverIO 10.2.0-alpha it matched the CLI on 6 of 15 pages checked; the differences are listed below.

```ts
import { getSnapshot } from '@wdio/elements'

const { format, text, elements, refs } = await getSnapshot(browser, {
  viewport: true
})
// text: '- button "start" [ref=e1]  → ~start' (one line per node)
// elements: { e1: { selector, tagName, role, text } }
// refs: SnapshotRef[], on format 'snapshot' only
```

The result fields:

- `format`: `'snapshot'` or `'legacy'`, the renderer that produced the result.
- `text`: the tree with `eN` refs.
- `elements`: each ref's selector, role and name. On the snapshot path `tagName` is empty.
- `refs`: the `SnapshotRef[]` behind the text, on the snapshot path only.

On the snapshot path a ref can carry no selector: when none of its candidates resolves to its element under BiDi, its `elements` entry has `selector: ''` and its line in `text` has no `→` part.

Options: `viewport` (or its alias `inViewportOnly`; `viewport` wins when both are set). The default differs by renderer: viewport-only on the legacy path, the full page on the snapshot path. Pass `{ viewport: true }` on long pages, where it is much smaller and faster.

`snapshotRenderer()` returns `'snapshot'` or `'legacy'` for the installed `webdriverio`. It reports the version gate only: if `@wdio/snapshot` fails to load, `getSnapshot` falls back to legacy with a warning, and the result's `format` is the authoritative answer.

Native sessions (`platformName` of Android, iOS, Mac or Windows with no `browserName`) parse the page source on the snapshot path. Errors on the snapshot path are `SnapshotError`s and propagate.

The DevTools **per-action trace capture** is a separate path with its own page scripts, so a locator in a trace can differ from the one `getSnapshot` renders.

Differences from the CLI, whose session holds state this function does not have. The renderer and selector logic are shared:

- The CLI session installs a page recorder that marks elements with JS click listeners as clickable. A plain `getSnapshot` has none, so a control with only a click listener gets no ref.
- The CLI appends a `Requests failed:` note.
- The CLI numbers refs across the actions of its session. Here they start at `e1` on every call.

`@wdio/devtools-service`'s `browser.getSnapshot()` calls this function with `viewport` defaulting to `true` on both renderers, so it reads the visible viewport unless you pass `{ viewport: false }`. If the call fails it logs a warning and returns `{ format, text: '[Snapshot unavailable]', elements: {} }` (plus `refs: []` on the snapshot format) instead of throwing; the `getSnapshot` exported here throws.

### Browser

```ts
import { getInteractableBrowserElements } from '@wdio/elements'

const elements = await getInteractableBrowserElements(browser, {
  includeBounds: true,
  inViewportOnly: true
})
```

```ts
import { getBrowserAccessibilityTree } from '@wdio/elements'

const nodes = await getBrowserAccessibilityTree(browser, { inViewportOnly: true })
```

### Mobile

```ts
import { getMobileVisibleElements } from '@wdio/elements'

const elements = await getMobileVisibleElements(browser, 'ios', {
  includeBounds: true,
  includeContainers: false
})
```

### Locator generation

```ts
import { generateAllElementLocators, xmlToJSON } from '@wdio/elements/locators'

const locators = generateAllElementLocators(pageSource, {
  platform: 'android',
  viewportSize: { width: 1080, height: 2340 }
})
```

## API

### `getElements(browser, params)`

Auto-detects platform and returns a unified result.

| Param | Type | Default | Description |
|---|---|---|---|
| `inViewportOnly` | `boolean` | `true` | Skip off-screen elements |
| `includeContainers` | `boolean` | `false` | Include layout containers (mobile only) |
| `includeBounds` | `boolean` | `false` | Include element bounding boxes |
| `limit` | `number` | `0` | Max elements (0 = no limit) |
| `offset` | `number` | `0` | Pagination offset |

### `getSnapshot(browser, options)`

Returns `GetSnapshotResult` — `{ format, text, elements, refs? }`; see [Accessibility snapshot](#accessibility-snapshot-getsnapshot) for the fields.

| Param | Type | Default | Description |
|---|---|---|---|
| `viewport` | `boolean` | `true` on the legacy renderer, `false` on the snapshot renderer | Only include what intersects the viewport; `inViewportOnly` is accepted as an alias and `viewport` wins when both are set |

### `getInteractableBrowserElements(browser, options)`

Single `querySelectorAll` walk — returns flat list of interactable elements.

### `getBrowserAccessibilityTree(browser, options)`

Single DOM walk returning the accessibility tree as a flat `AccessibilityNode[]`.

### `getMobileVisibleElements(browser, platform, options)`

Parses page source XML (2 HTTP calls total) and returns elements with generated locators.

### `@wdio/elements/locators`

Re-exports the full locator generation pipeline from `@wdio/devtools-core`:

- `xmlToJSON`, `xmlToDOM`, `evaluateXPath`, `checkXPathUniqueness`
- `findDOMNodeByPath`, `parseAndroidBounds`, `parseIOSBounds`
- `flattenElementTree`, `countAttributeOccurrences`, `isAttributeUnique`
- `isInteractableElement`, `isLayoutContainer`, `hasMeaningfulContent`
- `shouldIncludeElement`, `getDefaultFilters`
- `getSuggestedLocators`, `getBestLocator`, `locatorsToObject`
- `generateAllElementLocators`

## Types

```ts
export type {
  BrowserElementInfo, GetBrowserElementsOptions,
  MobileElementInfo, GetMobileElementsOptions,
  AccessibilityNode,
  VisibleElementsResult,
  GetSnapshotOptions, GetSnapshotResult,
  CandidateKind, SnapshotCandidate, SnapshotNode, SnapshotRef
} from '@wdio/elements'

// From @wdio/elements/locators:
export type {
  ElementAttributes, JSONElement, Bounds,
  FilterOptions, UniquenessResult,
  LocatorStrategy, LocatorContext,
  ElementWithLocators, GenerateLocatorsOptions
} from '@wdio/elements/locators'
```
