---
'@wdio/devtools-service': patch
---

The service no longer redeclares `browser.getPuppeteer` as optional. WebdriverIO 9 and 10 already declare it, and the service's `getPuppeteer?: () => Promise<unknown>` on the global `WebdriverIO.Browser` clashed with theirs, so a project type-checking with `skipLibCheck` off got `TS2430: Interface 'Browser' incorrectly extends interface 'BrowserCommandsType'` from the service's types.
