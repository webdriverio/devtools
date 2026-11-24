---
'@wdio/selenium-devtools': patch
---

In telemetry mode the Selenium adapter no longer reads the page viewport at session start. The manifest never used it, and the read cost a driver round-trip per session.
