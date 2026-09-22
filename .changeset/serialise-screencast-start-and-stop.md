---
"@wdio/devtools-core": patch
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Stop a screencast session outliving the recording it was armed for. A `stop()` arriving while the CDP handshake was still in flight returned early — the recording flag it checks is only set once the handshake finishes — so the session and its frame listener stayed live after teardown and kept pushing frames into the buffer the next recording reuses. `start()` and `stop()` are now serialised, so a stop always runs against a start that has finished arming and tears down what that start armed.

The visible consequence of the fix: `stop()` now waits for an in-flight handshake rather than returning immediately — so every driver primitive that handshake awaits is ceilinged. An unbounded one (the service's `getPuppeteer()`/`pages()`/`createCDPSession()`/`Page.startScreencast`, the polling path's first screenshot, Selenium's `createCDPConnection`) would have parked teardown behind a driver that never answers, turning a leaked session into a hung test run. On the ceiling the handshake gives up and the recorder falls back to polling, or reports the screencast unavailable when polling was what wedged.

Nothing is claimed until the handshake has answered, which is what keeps the ceiling safe: a `Page.startScreencast` that times out leaves no session, no frame listener and no stream behind for teardown to find. The same ceiling covers the stop-side `Page.stopScreencast` send, so a wedged stop cannot block the next recording either.
