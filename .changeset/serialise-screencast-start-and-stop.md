---
"@wdio/devtools-core": patch
"@wdio/devtools-service": patch
"@wdio/selenium-devtools": patch
"@wdio/nightwatch-devtools": patch
---

Stop a screencast session outliving the recording it was armed for. A `stop()` arriving while the CDP handshake was still in flight returned early — the recording flag it checks is only set once the handshake finishes — so the session, its frame listener and the browser-side screencast stream stayed live after teardown (the late frames themselves were moot: every adapter builds a fresh recorder per session). `start()` and `stop()` are now serialised, so a stop always runs against a start that has finished arming and tears down what that start armed.

The visible consequence of the fix: `stop()` now waits for an in-flight handshake rather than returning immediately — so every driver primitive that handshake awaits is ceilinged. An unbounded one (the service's `getPuppeteer()`/`pages()`/`createCDPSession()`/`Page.startScreencast` and the `session.detach()` its timeout path takes, the polling path's first screenshot, Selenium's `createCDPConnection`) would have parked teardown behind a driver that never answers, turning a leaked session into a hung test run. On the ceiling the handshake gives up and the recorder falls back to polling, or reports the screencast unavailable when polling was what wedged.

Nothing is claimed until the handshake has answered, which is what keeps the ceiling safe: a `Page.startScreencast` that times out leaves no session, no frame listener and no stream behind for teardown to find — and a CDP session or connection that completes after the ceiling is detached (or, for Selenium, has its socket closed) when it lands, so no orphan outlives the recording. Selenium's stop closes the socket its recording opened on the success path too: each `createCDPConnection` overwrites the driver's single connection slot and `quit()` closes only the current one, so every recording rotation on one driver would otherwise leak one live websocket for the session's life. The same ceiling covers the stop-side `Page.stopScreencast` send, so a wedged stop cannot block the next recording either.
