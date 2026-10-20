---
"@wdio/elements": major
"@wdio/devtools-service": major
---

`getSnapshot` now produces the same text as `wdio session snapshot --selectors`, by delegating to `@wdio/snapshot` instead of keeping a second renderer that drifted from the CLI's. Agents that read the CLI's output and agents that call this function now see one format.

Breaking: it returns `{ text, refs }` rather than `{ text, elements }`, takes `{ viewport }` (default `false`, the full page) in place of `{ inViewportOnly }` (default `true`), no longer prefixes a `[Page: …]` header, and throws on failure instead of returning a placeholder. `serializeWebSnapshot`, `serializeMobileSnapshot` and their option and result types are removed. Requires `webdriverio` ^10, and declares `engines.node` `>=22.19.0`. A mobile browser session (Chrome on Android, Safari on iOS) is now snapshotted from the page rather than from Appium's page source, and Mac and Windows native sessions take the native path. `getElements` on a native session no longer attaches the raw page source as `tree.attributes._sourceXML`.

Breaking for `@wdio/devtools-service`: it now requires WebdriverIO 10. It consumes `@wdio/elements` 2, which delegates to `@wdio/snapshot`, and that package pins `webdriverio` exactly to a v10 release, so the service's peer ranges for `webdriverio`, `@wdio/types`, `@wdio/reporter`, `@wdio/logger`, `@wdio/protocols` and `@wdio/allure-reporter` are narrowed to `^10.0.0`. Its `browser.getSnapshot()` returns the same `{ text, refs }` instead of `{ text, elements }`, and the `inViewportOnly` option is replaced by `viewport`. The service still defaults to the viewport (`viewport: true`) so repeated calls from an agent loop stay small, whereas calling `getSnapshot` from `@wdio/elements` directly defaults to the full page.
