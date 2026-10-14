---
minor
---

Node.js 22.19 or newer is required on the PATH, where 18 was enough before: the backend this package launches now needs it, and `enable()` checks the minor as well as the major so a Node 22.0 reports what to upgrade instead of failing later. Node 18 and 20 are past end of life. Attaching to a backend someone else runs, via `DEVTOOLS_PORT`, still needs no local Node.
