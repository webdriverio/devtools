---
"@wdio/devtools-core": patch
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Stop a screencast session outliving the recording it was armed for. A `stop()` arriving while the CDP handshake was still in flight returned early — the recording flag it checks is only set once the handshake finishes — so the session and its frame listener stayed live after teardown and kept pushing frames into the buffer the next recording reuses. `start()` and `stop()` are now serialised, so a stop always runs against a start that has finished arming and tears down what that start armed.

The visible consequence of the fix: `stop()` now waits for an in-flight handshake rather than returning immediately. Only Selenium caps its own; the service's CDP handshake and the polling path's first screenshot do not, so a driver that wedges in one of those now wedges `stop()` as well.
