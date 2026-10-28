---
'@wdio/selenium-devtools': patch
---

A plain Node.js script run without mocha, jest or cucumber now finishes with its test and suite closed. When the script ends, the session test the adapter created for it is marked passed (or keeps the state it already had) with an end time, its suite is finalized, and that final state reaches the dashboard before the worker socket closes. A script that quits its driver and builds another stays one test. A test the script opened itself with `DevTools.startTest()` is left for the script's own `DevTools.endTest()`.
