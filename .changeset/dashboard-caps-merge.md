---
'@wdio/devtools-service': patch
---

A `goog:chromeOptions` passed in `devtoolsCapabilities` now merges with the dashboard defaults instead of replacing them, so the window keeps hiding the automation infobar.
