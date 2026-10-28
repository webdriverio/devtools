---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A `node:assert` row only names an element read in the same test (or Cucumber scenario). An assertion in a later test, such as `assert.ok(true)`, no longer boxes an element an earlier test read the same value from. With the WebdriverIO service, a `browser.getTitle()` issued while one of the service's own title reads is still pending keeps its row in the Actions list.
