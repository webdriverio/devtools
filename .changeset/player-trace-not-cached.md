---
'@wdio/devtools-app': patch
---

A trace opened in `show-trace` is no longer written to the browser's local storage. That cache only backs the live dashboard's reload while its backend is down, so a trace opened in the player could replay there as if it were the last live run, and a large trace filled the storage quota.
