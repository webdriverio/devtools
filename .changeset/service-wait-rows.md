---
'@wdio/devtools-service': patch
---

A wait (`waitUntil`, `waitForExist`, `waitForDisplayed`, `waitForEnabled`, `waitForClickable`) is one row that appears as soon as it starts and is updated when it ends, carrying the timeout error if it timed out. The commands it issued, the reads in a `waitUntil` condition or an element wait's polls, are listed under it, one row per distinct call, collapsed by default in the Actions list and the trace player. A wait inside a `waitUntil` condition nests the same way. Commands outside a wait are listed exactly as before.
