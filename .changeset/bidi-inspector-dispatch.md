---
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Selenium and Nightwatch traces on Chrome listed every BiDi request twice, a pending row beside the completed one, because selenium-webdriver's network inspector delivers every network event to every subscriber. Each request is now one row, a redirect continues that row rather than adding one, and a request the browser gives up on is closed as a failure instead of staying pending.
