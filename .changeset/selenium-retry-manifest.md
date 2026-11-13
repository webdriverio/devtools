---
'@wdio/selenium-devtools': patch
---

A retried Mocha test is listed once in the artifacts manifest, with its last attempt marked final. An attempt Mocha will retry is reported failed rather than passed, and a repeated Cucumber step text is no longer read as a retry. Each attempt of a retried test keeps its own group in a trace that holds more than one test.
