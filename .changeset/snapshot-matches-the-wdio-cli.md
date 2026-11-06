---
"@wdio/elements": minor
"@wdio/devtools-service": minor
---

`getSnapshot` can now render with `@wdio/snapshot`, the renderer behind `wdio session snapshot --selectors`. It is used on WebdriverIO 10.2 (prereleases included) with `@wdio/snapshot` 10.2 or later resolvable (`npm i -D @wdio/snapshot`, declared as an optional peer `^10.2.0`); otherwise, including on WebdriverIO 9 and 10.0–10.1, the current output is kept. The result gains `format: 'legacy' | 'snapshot'`, and on the snapshot path `refs`; `elements` is filled on both paths. `viewport` is accepted next to `inViewportOnly`, and wins when both are set. `viewport` defaults to viewport-only on both renderers. `browser.getSnapshot()` in the service defaults to the viewport on both. Existing code keeps compiling. With npm, `@wdio/cli` 10.2 already brings `@wdio/snapshot` (through `@wdio/session`), so a WebdriverIO 10.2 project that installed the CLI renders with `@wdio/snapshot` unless it removes it; without the CLI, install it yourself.
