---
'@wdio/devtools-service': major
---

Move the service to WebdriverIO 10. WDIO 10 and its `@wdio/logger` require Node 22.19 or newer, so the service does too, and its peers follow: `webdriverio` ^10, `@wdio/allure-reporter` ^10 and `@wdio/protocols` ^10, with `puppeteer-core` (>=24 <26) an optional peer for the CDP screencast.

The `devtools` peer is gone. WebdriverIO 10 dropped the `devtools` automation protocol, so the dashboard window can no longer be opened through it; it now opens as a plain Chrome WebDriver session.

`browser.getSnapshot()` now delegates to `@wdio/elements` 2.0 and returns `{ text, refs }` instead of `{ text, elements }`. It takes `{ viewport }` in place of `{ inViewportOnly }`, and called with no options it still reads the viewport (`{ viewport: true }`).
