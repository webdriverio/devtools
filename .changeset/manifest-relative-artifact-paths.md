---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

`artifacts[].path` in the artifacts manifest is now relative to the manifest's directory, so a results folder can be moved or downloaded and still be read. A script that read the absolute path must resolve it against the manifest's directory.
