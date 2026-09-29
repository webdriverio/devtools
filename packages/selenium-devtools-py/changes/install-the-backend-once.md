---
minor
---

Install the dashboard backend once with `selenium-devtools install-backend`, instead of fetching it on every run. Runs prefer what it installs and reach `npx` only when nothing is there — which also removes a per-run registry round trip, and turns a proxy that declines the package into an install-time error rather than a test run that quietly captures nothing.

A cold `npx` now gets its own, far larger budget: it has to download a dependency tree before the server it is timing even starts, and the old 40 s covered both, so a first run could fail while the retry succeeded from cache. When a backend does fail to start, the error now carries the command that was run and the last lines it printed.
