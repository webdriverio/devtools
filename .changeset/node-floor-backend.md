---
'@wdio/devtools-backend': major
---

The package requires Node 22.19 or newer and says so in `engines`. Its `@wdio/logger` dependency moves to the 10.x line, which needs that Node; Node 18 and 20 are past end of life and were not tested. A WebdriverIO 9 project on Node 22 is unaffected.
