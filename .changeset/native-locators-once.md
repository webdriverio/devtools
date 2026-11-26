---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
'@wdio/elements': patch
---

Native per-action snapshots generate element locators once instead of twice: the element list reuses the locators already built for the visible elements. In a local benchmark on an 846 KB page source, a capture's locator work dropped from 3.2 s to 0.8 s. A name containing `&`, `<` or `"` is now recognised as unique again, so such an element keeps its accessibility-id locator instead of falling back to XPath.
