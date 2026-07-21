# @wdio/elements

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
