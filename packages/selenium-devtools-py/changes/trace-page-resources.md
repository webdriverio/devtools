---
minor
---

Trace mode stores the stylesheets and fonts the page used, so the player replays them from the archive instead of the site under test; images still load from the site. On by default; `trace_resources="none"` (or `--devtools-trace-resources none`, ini `devtools_trace_resources`, `DEVTOOLS_TRACE_RESOURCES=none`) stores nothing. The page collector reads each one back from the browser's HTTP cache, and the archive leaves those reads out of its network rows. Live mode is unchanged. Needs a backend that serves the `collectorDrainResources` page script; an older one stores nothing.
