---
'@wdio/devtools-backend': patch
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A trace zip stores each action screenshot once. The `frame-snapshot` event for an action used to carry its screenshot again as base64 inside the page it describes, beside the same screenshot under `resources/`; it now references that file through `resourceOverrides`, which a trace viewer resolves to the stored image. On a WebdriverIO cucumber example trace this takes the zip from 1.63 MB to 1.10 MB and `trace.trace` from 538 KB to 5 KB. The DevTools trace player reads such a zip as before.
