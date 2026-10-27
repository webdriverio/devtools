---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Ship the `show-trace` bin the package has always declared. The file was never committed, so `npx show-trace <trace.zip>` failed in a project that installed only this adapter.
