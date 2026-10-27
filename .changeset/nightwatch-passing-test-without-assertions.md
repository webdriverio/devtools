---
'@wdio/nightwatch-devtools': patch
---

Report passing Nightwatch tests that make no Nightwatch assertions (`passed: 0, failed: 0, errors: 0, skipped: 0`) as `passed` instead of `skipped`, and treat `errors > 0` as `failed`.
