---
'@wdio/devtools-service': patch
---

Use the project's own `@wdio/types`, `@wdio/logger` and `@wdio/reporter` instead of pinned copies. The service pinned them at exact 9.x versions in `dependencies`, so a WebdriverIO 10 project installed a second set beside its own. On v10 that made the service class fail to type-check when passed directly in `services` (`[DevToolsHookService, options]`), because its types came from the 9.x copy. They are now peers accepting 9 and 10: `webdriverio` already brings the first two, and npm and pnpm install a missing `@wdio/reporter` automatically.
