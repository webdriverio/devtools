---
"@wdio/devtools-backend": patch
---

The backend's `@wdio/logger` dependency was pinned to exactly 10.0.0 and is now `^10.0.0`, so it shares the `@wdio/logger` the rest of a WebdriverIO 10 install already has instead of adding a second copy.
