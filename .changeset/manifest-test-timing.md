---
"@wdio/devtools-service": minor
---

The artifacts manifest (`devtools-artifacts-<sessionId>.json`) now carries each test's start and end time, framework-reported duration, and the failure message of its final attempt, so reporters can build a per-test record without opening the trace zip.
