---
"@wdio/devtools-script": patch
---

Observe `documentElement` rather than `body`, so a stylesheet injected into `<head>` after load is captured. The anchor is serialized as soon as `body` exists — before a bundler appends its lazily loaded `<style>` or `<link rel="stylesheet">` — so a body-rooted observer reported neither insertion and the replay held no stylesheet at all, rendering every route as raw HTML while its `body` content replayed correctly.
