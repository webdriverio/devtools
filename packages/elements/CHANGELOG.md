# @wdio/elements

## 1.1.2

### Patch Changes

- aeb3804: A trace records the same thing whichever runner produced it, and the player reads it back in that runner's own terms.

  **Locators you can paste into your own test.** The accessibility tree and element overlay used to hand back `a*=Logout` to everyone — WebdriverIO syntax, which Selenium's `By.css` and Nightwatch's `'css selector'` both reject. Each trace now carries its runner, and a captured locator is written in that runner's dialect: WebdriverIO keeps its text form, Selenium gets XPath, and Nightwatch prefers a native CSS locator (`button[type="submit"]`) because it is the one runner that reads a bare selector string under a default strategy. Where an XPath locator is genuinely the best available, the A11y panel names the call that resolves it. The player also resolves XPath now, so those rows draw their overlay boxes, and traces recorded before this still resolve their old locators.

  **Rows name the element they acted on.** Selenium consumes a locator at `findElement` and hands back an opaque handle, so its element rows reached the player with nothing to box or mark — no click points at all. Both Selenium and Nightwatch now carry the element's locator onto the row, including for assertions, which name no element of their own: a `node:assert` resolves its target from the value it was given, and a Nightwatch native assert reads it from the call. A page-level read records that its value belongs to no element, so a title assertion cannot inherit the box of an element that happens to read the same text. WebdriverIO stamps the element a command actually acted on rather than the last one resolved, which was wrong whenever two handles were resolved before either was used.

  **Every document instruments itself.** Selenium now registers its page collector at document start over BiDi, as the WebdriverIO and Nightwatch adapters already did, instead of appending a script after each navigation. On a fast two-page form that recovers input events that were being dropped while the collector came up, and anchors destination pages that previously lived and died unrecorded. Nightwatch re-establishes the same instrumentation when it replaces a session mid-run, which also restores network capture that was silently absent for every session after the first.

  **The action tree matches the run.** Nightwatch's `describe/it` interface showed one group for a whole module; each `it` is now its own group. A Cucumber scenario is named instead of showing a generated id, and nests under its feature. A group no longer repeats its parent's name. `traceGranularity: 'session'` covers a whole Nightwatch run rather than only its last browser session, and `'test'` remains the recommendation for Cucumber.

  **Live mode replays the right page.** The player bounded a row's DOM by the next row in arrival order, which is not the next row in time — a Nightwatch native assert, held back until its outcome is known, could bound a row that ran seconds later. Selenium additionally drained the page only at navigation in live mode, leaving nothing to replay between them. Both are fixed; trace-mode replay is unchanged.

  **Fewer swallowed failures.** A screenshot poll landing inside a click could make the click report success while doing nothing; the recorder now stands aside while an input command is in flight. A driver error is no longer mistaken for a probe result, which could put an error object into a screencast frame and lose the run's entire trace at export. A Nightwatch wait that times out produces a row, so the failure appears in the timeline and the Errors tab rather than only in console text, and Cucumber assertions carry a real pass/fail instead of rendering neutral.

## 1.1.1

### Patch Changes

- 64d54a9: - Bump @wdio/devtools-core to 1.0.1

## 1.1.0

### Minor Changes

- e1e859b: ### 🚀 Features

  - **`getSnapshot()`** — single call for web and mobile that returns an AI-readable text tree with embedded `e1`, `e2`, … virtual element IDs plus an elements map for direct selector resolution. No post-processing required.
  - **`browser.getSnapshot()`** — WDIO runtime accessor registered by `@wdio/devtools-service` in the `before` hook, calling `getSnapshot()` directly with zero trace-mode overhead (no screenshot round-trip, no page-settling).

  ### 🛠 Core additions (`@wdio/devtools-core` — private)
  - `buildSnapshot()` — platform-agnostic formatter converting flat `SnapshotNode[]` into text + elements map.
  - `accessibilityNodesToSnapshotNodes()` — web adapter from `AccessibilityNode[]`.
  - `jsonElementToSnapshotNodes()` — mobile adapter from `JSONElement` tree.
  - `isStatictextEchoedByParent()` — shared statictext echo-suppression helper.
  - New types: `SnapshotNode`, `SnapshotElement` (with `qualifiedSelector` for `.instance(N)` disambiguation), `SnapshotResult`.
  - `tagName` field on internal `MobileFlatNode`.
