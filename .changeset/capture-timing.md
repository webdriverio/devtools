---
'@wdio/devtools-service': minor
'@wdio/selenium-devtools': minor
'@wdio/nightwatch-devtools': minor
---

Setting `DEVTOOLS_CAPTURE_TIMING=1` on a trace-mode run times every per-action capture. When the trace is written, the run prints a table with each probe's count, total, median, p95 and max (url, title, page source, accessibility tree, element list, screenshot, and the in-process step that builds the snapshot), plus how much of the run's wall time went to capturing. The raw records are appended to `capture-timing-<pid>.ndjson` beside the trace. Each record names the command and whether the capture was a wait's or a matcher's poll. The variable only measures: nothing is captured differently, and with it unset nothing is timed or written.
