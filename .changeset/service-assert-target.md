---
'@wdio/devtools-service': patch
---

A `node:assert` row names the element whose read produced the asserted value, and none for a page-level value: `assert.notEqual(await browser.getTitle(), 'Secure Area')` no longer boxes the last element the test resolved. The test's own `browser.getTitle()` is now a `Page.getTitle` row in the Actions list, as in the other adapters.
