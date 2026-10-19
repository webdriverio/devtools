---
'@wdio/devtools-service': major
---

The package requires Node 22.19 or newer and says so in `engines`, because the backend it installs now does. The WebdriverIO peer range stays `^9 || ^10`; a WebdriverIO 9 project on Node 22 is unaffected, while Node 18 and 20, both past end of life, are no longer supported.
