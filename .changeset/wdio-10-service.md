---
'@wdio/devtools-service': patch
---

An element whose parent is a WebdriverIO 10 browsing context now resolves to its browser when the collector is injected, as `@wdio/utils` resolves it; before, the walk up the parent chain stopped at the context.
