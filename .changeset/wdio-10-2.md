---
"@wdio/devtools-backend": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

The `@wdio/logger` each package depends on, and the `webdriverio` the Selenium and Nightwatch adapters depend on, move to `^10.2.0`, alongside the rest of the WebdriverIO toolchain the repository now builds and tests against. The backend's `@wdio/logger` was pinned to exactly 10.0.0 and is now a caret range. Installs that resolved 10.0.x or 10.1.x resolve 10.2.x from now on.
