---
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

Stop pinning `chromedriver` as a dev dependency. A pinned driver rots against whatever Chrome a developer has installed, and pnpm puts the package's `node_modules/.bin` on `PATH`, where Selenium Manager finds it, prefers it over resolving one itself, and on a version mismatch only warns before returning it anyway. The adapters' examples then failed to start a session at all, against any Chrome whose major had moved on from the pin.

With no driver on `PATH`, Selenium Manager resolves one matching the installed browser. Nightwatch needs no package either: its Chrome service builder reports `requiresDriverBinary: false` and passes an unset `server_path` through to that same resolver, and it declares `chromedriver` an optional peer. This is a development-only dependency, so nothing changes for consumers of either package.
