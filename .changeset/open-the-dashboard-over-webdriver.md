---
'@wdio/devtools-service': patch
---

Open the dashboard window over WebDriver and stop requiring the `devtools` package. The launcher opened it with `automationProtocol: 'devtools'`, which loads the `devtools` package. The service listed `devtools` `^8.42.0` as a peer, so npm installed it and an old Puppeteer into every project, and on WebdriverIO 10 the dashboard window failed to open when it was absent (`Couldn't find automation protocol "devtools"`). The window now opens through chromedriver, the same way the test sessions do, still without the "controlled by automated test software" bar, and `devtools` is no longer a peer.
