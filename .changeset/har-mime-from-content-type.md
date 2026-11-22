---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A trace's fetch/XHR row on Safari, or on any session whose requests the page collector records, now names its mime type, taken from the response's `content-type` header. The collector records those rows with headers and a body but no mime type, so `content.mimeType` was written as `""` and the trace player, which shows a body only for a textual type, hid every response body.
