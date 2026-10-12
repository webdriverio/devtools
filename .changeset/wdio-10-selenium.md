---
'@wdio/selenium-devtools': major
---

Remove the `webdriverio` dependency, which nothing in the adapter imported, and move to `@wdio/logger` 10. The logger requires Node 22.19 or newer, so installs on older Node versions are no longer supported.
