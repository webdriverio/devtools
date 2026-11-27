---
'@wdio/devtools-service': patch
'@wdio/selenium-devtools': patch
'@wdio/nightwatch-devtools': patch
---

A retried test's per-test screenshot is kept per attempt. Each attempt's file and manifest entry carry the attempt, so a retry no longer overwrites the earlier attempt's screenshot.
