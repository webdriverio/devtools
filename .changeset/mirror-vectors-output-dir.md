---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
'@wdio/devtools-app': patch
'@wdio/devtools-backend': patch
---

A test file sitting directly inside a `node_modules` folder no longer gets its video and trace written next to it; output falls back to the config or working directory, as it already did for a test file deeper inside `node_modules`. Capabilities given as an array are no longer read as a native mobile session.
