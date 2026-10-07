---
'@wdio/nightwatch-devtools': patch
---

Open the dashboard window over WebDriver and stop requiring the `devtools` package. The plugin opened it with `automationProtocol: 'devtools'`, which loads the `devtools` package, so `devtools` `^8.42.0` was a peer and npm installed it and an old Puppeteer into every project. Without it the dashboard window did not open (`Couldn't find automation protocol "devtools"`). The window now opens through chromedriver, still without the "controlled by automated test software" bar, and `devtools` is no longer a peer.
