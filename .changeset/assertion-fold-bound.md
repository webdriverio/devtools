---
'@wdio/devtools-service': patch
---

An `expect.*` row now folds only into a read its own matcher issued. A matcher whose read is not logged, such as `toHaveTitle`, used to overwrite the row of an unrelated earlier read; `toHaveCookie` and `toBeStable` now fold into their read instead of leaving it visible beside the assertion.
