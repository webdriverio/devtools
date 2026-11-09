---
'@wdio/selenium-devtools': minor
---

Add `mode: 'telemetry'` to the Selenium adapter. It starts no backend and opens no dashboard, captures no per-action DOM, screenshots or screencast, and writes no trace zip. The test lifecycle still runs and the artifacts manifest is written at session end, so results can reach an external sink without a replayable trace.
