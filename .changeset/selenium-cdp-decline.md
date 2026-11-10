---
'@wdio/selenium-devtools': patch
---

Decide the screencast's CDP mode from the session capabilities. A session that advertises no CDP endpoint (Safari, Appium, Firefox) now goes straight to screenshot polling with a plain log line, instead of calling `createCDPConnection` and logging `CDP screencast unavailable (debuggerAddress.match is not a function)`.
