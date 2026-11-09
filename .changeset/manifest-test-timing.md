---
"@wdio/devtools-service": minor
---

The WebdriverIO service's artifacts manifest (`devtools-artifacts-<sessionId>.json`) now carries each test's start and end time, framework-reported duration (Cucumber scenarios fall back to wall-clock time, since WDIO's Cucumber duration is only the nanoseconds field of the worst step), and the failure message of its final attempt, so reporters can build a per-test record without opening the trace zip. The Selenium and Nightwatch adapters do not write these fields yet.
