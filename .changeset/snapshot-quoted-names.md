---
'@wdio/devtools-service': patch
'@wdio/nightwatch-devtools': patch
'@wdio/selenium-devtools': patch
'@wdio/devtools-app': patch
---

A trace's accessibility snapshot escapes a quote or backslash inside an element's name or purpose, so a name such as `Press "  →  next` no longer makes the A11y tab copy and highlight the wrong locator. Snapshots in traces written before this still read as before.
