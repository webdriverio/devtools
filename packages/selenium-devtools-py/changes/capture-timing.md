---
minor
---

Setting `DEVTOOLS_CAPTURE_TIMING=1` on a trace-mode run times the screenshot and the two page reads taken for every command. When the trace is exported, the run prints the same per-probe table the JS adapters print, and appends the raw records to `capture-timing-<pid>.ndjson` beside the trace. Nothing is captured differently.
