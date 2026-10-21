---
'@wdio/devtools-backend': patch
'@wdio/devtools-app': patch
---

A rerun whose process exited before it reported anything, such as a config preflight refusing to start or a missing driver, left the dashboard showing "Running" with only a Stop button, so it could not be rerun. The backend now tells the dashboard when that happens, and the tests the run never reached are marked failed with the exit code or signal as their error.
