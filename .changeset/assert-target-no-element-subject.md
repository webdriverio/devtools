---
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A `node:assert` row on a page-level value, such as `assert.notEqual(await driver.getTitle(), 'Welcome')`, names no element. It used to box an element whose earlier read returned the expected value.
