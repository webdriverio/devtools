---
"@wdio/elements": minor
"@wdio/devtools-service": minor
---

`getSnapshot` now renders with the renderer the installed WebdriverIO picks. From WebdriverIO 10.2 (prereleases included) it uses `@wdio/snapshot`, the renderer behind `wdio session snapshot --selectors`. WebdriverIO 9 and 10.0–10.1 keep the current output. The result gains `format: 'legacy' | 'snapshot'`, and on the snapshot path `refs`; `elements` is filled on both paths. `viewport` is accepted next to `inViewportOnly`, and wins when both are set. Defaults stay per renderer: viewport-only on the legacy path, the full page on the snapshot path. `browser.getSnapshot()` in the service defaults to the viewport on both. Existing code keeps compiling.
