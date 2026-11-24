---
'@wdio/selenium-devtools': patch
'@wdio/devtools-core': patch
'@wdio/devtools-service': patch
---

A Cucumber scenario that was queued before the Selenium driver existed is now stamped with its `.feature` file, so the artifacts manifest lists it as a scenario rather than a feature. `attempts[].endTime` in the manifest now ends when the test ends, not after the service has waited for its command hooks to settle.
