---
'@wdio/selenium-devtools': patch
---

The README's mocha example now reads its heading from a page that still has one: example.com no longer serves an `<h1>`, so the example's wait timed out before its `getText()` and assertion ever ran.
