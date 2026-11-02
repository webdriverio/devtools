---
'@wdio/devtools-app': patch
'@wdio/devtools-backend': patch
---

A replayed trace runs no script. The page a trace recorded is rendered in a sandboxed frame, scripts, inline event handlers, `srcdoc` and `javascript:` URLs are dropped from it on every update, not only the first render, and the dashboard and `show-trace` now send the same Content-Security-Policy as the hosted player. A trace someone else recorded can therefore be opened safely in any of them.
