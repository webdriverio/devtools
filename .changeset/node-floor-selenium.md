---
'@wdio/selenium-devtools': major
---

The package requires Node 22.19 or newer and says so in `engines`. Its `webdriverio` and `@wdio/logger` dependencies move to the 10.x lines, which need that Node; Node 18 and 20 are past end of life and were not tested.
