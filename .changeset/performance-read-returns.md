---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Navigation rows carry their performance timings again. The script that reads them ran in the browser but never returned its result to the adapter, so every navigation row was left without load timings, cookies or document info.
