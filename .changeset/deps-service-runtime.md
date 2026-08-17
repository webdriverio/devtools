---
"@wdio/devtools-service": patch
---

Pick up the merged dependency updates. `yazl` moves 2 to 3 (and `@types/yazl` with it), which is the library the trace zip is written with; `@wdio/reporter` and `@wdio/types` move 9.28.0 to 9.30.1 and `@wdio/logger` 9.18.0 to 9.29.1. These are runtime dependencies, so the published range only changes when the package is released.
