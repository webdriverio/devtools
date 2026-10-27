---
'@wdio/selenium-devtools': patch
---

Under `mocha --require @wdio/selenium-devtools` the test hooks are registered as a mocha root hook plugin (`mochaHooks`) before any spec loads, so the first test is no longer missed when it starts before the plugin's poll for mocha's globals, which dropped every command that test ran.
