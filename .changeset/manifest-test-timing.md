---
"@wdio/devtools-service": minor
---

The WebdriverIO service's artifacts manifest (`devtools-artifacts-<sessionId>.json`) now carries each test's start and end time, framework-reported duration, and the failure message of its final attempt, so reporters can build a per-test record without opening the trace zip. The Selenium and Nightwatch adapters do not write these fields yet.
