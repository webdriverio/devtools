# @wdio/devtools-core

## 1.0.2

### Patch Changes

- 34199c8: Find the collector bundle whether the package resolved to its build or its source. `loadCollectorSource` resolved `@wdio/devtools-script` and then read `script.js` from **that entry's directory**, which only holds when the entry is the built one. The repo tsconfig maps the package to `packages/script/src/index.ts`, and every resolver honouring those paths lands there instead — `tsx` and `ts-node` among them, which is how `wdio run <conf>.ts` loads a config. The read then ENOENTs on `packages/script/src/script.js`.

  Nothing failed loudly, which is why this survived: every caller treats an injection failure as a warning, so the run continued and lost its DOM capture. Surfaced as `Collector re-injection failed: ENOENT … packages/script/src/script.js` on a mobile-web Appium run, and reproduced in three lines against a plain `tsx` entry point, so it was never mobile-specific — any TS-config-driven run was affected.

  The bundle is now looked for beside the entry _and_ at `../dist/script.js`, and a genuine miss reports every path it tried instead of only the last.

- afc07ca: Take one DOM capture per action again. Trace mode had grown a second, eager post-action capture beside the pre-action one, with a `readyState` poll and a 250 ms pause on top to hide the fact that the eager one lands while the screen is still moving — so every action paid two captures, and on a native Appium session each capture is two serial round trips. Measured on the native example spec: 15 screenshots and 15 page-source reads against 8 and 8, and a 14.0–14.7 s test against 11.4 s, with the captured frames equivalent.

  The pre-action capture is the one that was right: taken before the command is issued, it is the moment the driver is guaranteed idle, so an action's result is the next action's "before". Only the last action has no successor to hand its result to, so a settle survives in exactly that one place, and it is gated rather than timed — no navigation, no wait. The eager capture, the poll that patched it and the document tag it was built on are deleted. Two related fixes ride along: a row with no capture of its own now replays the latest state at or before it rather than the nearest in absolute distance, which could hand it its successor's; and the screencast poll keeps at most one screenshot outstanding, so it cannot queue ahead of the test's own commands on a serialised driver.

- afc07ca: Stop a screencast session outliving the recording it was armed for. A `stop()` arriving while the CDP handshake was still in flight returned early — the recording flag it checks is only set once the handshake finishes — so the session, its frame listener and the browser-side screencast stream stayed live after teardown (the late frames themselves were moot: every adapter builds a fresh recorder per session). `start()` and `stop()` are now serialised, so a stop always runs against a start that has finished arming and tears down what that start armed.

  The visible consequence of the fix: `stop()` now waits for an in-flight handshake rather than returning immediately — so every driver primitive that handshake awaits is ceilinged. An unbounded one (the service's `getPuppeteer()`/`pages()`/`createCDPSession()`/`Page.startScreencast` and the `session.detach()` its timeout path takes, the polling path's first screenshot, Selenium's `createCDPConnection`) would have parked teardown behind a driver that never answers, turning a leaked session into a hung test run. On the ceiling the handshake gives up and the recorder falls back to polling, or reports the screencast unavailable when polling was what wedged.

  Nothing is claimed until the handshake has answered, which is what keeps the ceiling safe: a `Page.startScreencast` that times out leaves no session, no frame listener and no stream behind for teardown to find — and a CDP session or connection that completes after the ceiling is detached (or, for Selenium, has its socket closed) when it lands, so no orphan outlives the recording. Selenium's stop closes the socket its recording opened on the success path too: each `createCDPConnection` overwrites the driver's single connection slot and `quit()` closes only the current one, so every recording rotation on one driver would otherwise leak one live websocket for the session's life. The same ceiling covers the stop-side `Page.stopScreencast` send, so a wedged stop cannot block the next recording either.

## 1.0.1

### Patch Changes

- f0cbe45: ### 🐛 Fixes
  - Sanitize page source XML that may contain HTML artifacts
  - Enrich android-based locators when only className is present with child-text
