---
'@wdio/devtools-service': minor
---

Add `mode: 'telemetry'`. It skips the DevTools backend and UI window, takes no per-action capture, screencast or zip, and still runs the test lifecycle. At session end it writes the `devtools-artifacts-<sessionId>.json` manifest, which lists each test's state and the trace id of every attempt, so a run can be linked to its traces without recording them. Live and trace modes are unchanged.
