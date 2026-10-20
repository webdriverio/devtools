---
"@wdio/devtools-backend": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

The `@wdio/logger` each package depends on, and the `webdriverio` the Selenium and Nightwatch adapters depend on, move to their 10.1.0 lines (`^10.1.0`), alongside the rest of the WebdriverIO toolchain the repository now builds and tests against. An install that pinned either to 10.0.x resolves 10.1.x from now on.
