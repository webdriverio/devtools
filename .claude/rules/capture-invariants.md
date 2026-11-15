---
paths:
  - "packages/{core,service,selenium-devtools,nightwatch-devtools,script,selenium-devtools-py}/src/**"
  - "packages/shared/src/trace-actions.ts"
---

# Capture invariants

Rules whose violation sites span adapters or sit in an adapter's session file. Each rule lives in this file only.

## Rules

- Gate Resource Timing dedupe on a delivered BiDi network event (core `buildBidiSinks` sets `bidiNetworkObserved`; service `#bidiNetworkObserved`; Python `stats["observed"]`), never on `bidiActive` or `browser.isBidi`. Why: Appium 3.7 XCUITest attaches BiDi inspectors that deliver nothing, and the subscription gate left zero network rows.
  Selenium passes the same latch as `skipNetworkRequests`; its console gate is `bidiConsoleObserved`.
- Keep the `<script>` injection branches gated on `SessionCapturer.preloadRegistered`, not deleted. Why: they are the only capture without BiDi, and a missing collector is the fallback's only "document replaced" signal, which the preload makes permanently false.
- On Nightwatch's session re-arm (`session-init.ts` `armCaptureForSession`), register the collector preload with `script.addPreloadScript` before the BiDi attach, sequentially. Why: behind the attach the network subscribe took 6.2 s while the triggering command navigated, so registration landed after its own document was born.
- Selenium's `initPerDriverCapture` may register the preload inside its `Promise.all` only on selenium-webdriver versions whose `getBidi()` caches the connection before awaiting. Why: 4.52.0 caches the promise; 4.27.0 awaits `getCapabilities` before assigning, so two websockets open and `quit()` closes one.
  Nightwatch 3.16.0 pins selenium-webdriver 4.27.0, so `armCaptureForSession` stays sequential. Selenium's peer range (`>=4.8.0`) admits older versions; where that boundary falls is unverified.
- Pass `forceAnchor` (`collectorDrainExpression(true)`, `shared/src/page-scripts.ts`) from every Selenium and Nightwatch drain; only the WDIO pre-transition drain passes `false`. Why: a drain right after navigation beats the collector's async first anchor, reads an empty buffer, and the page's DOM dies with it. Forcing is free after a document's first anchor, since `#anchored` in `packages/script`
  survives `reset()`.
- The per-action capture gate is `skipsCapture` (`shared/src/trace-actions.ts`). Selenium, Nightwatch and Python capture after every command it does not skip; a test's first mapped command and its end-of-test frame always capture.
  Every `ACTION_MAP` method must appear in `METHOD_EFFECT` (`shared/src/trace-actions.ts`); skipped reads and waits still render rows and inherit the earlier capture via `FrameSnapshotIndex.claimAfter`.
  Don't gate on `mapCommandToAction`: each read or poll then captures, and a reported iOS suite went from 3:10 to 7:10. Don't add unmapped commands to the skip set: `executeScript`, `actions` and Nightwatch `submitForm` can navigate.
- Stamp `Date.now()` on a pre-capture whose timestamp predates `#currentTestStartWallTime` (service, Nightwatch and Selenium `index.ts`). Why: the previous test's finalize slot would be replaced by a post-reload page. Selenium initialises the field to `Date.now()`; the service and Nightwatch keep 0 without per-test hooks, so a standalone run is unaffected.
- Do not let a polled screenshot override an input or capture driver window (`driver-activity.ts` `isInputDispatchInFlight`, `isCaptureInFlight`). Why: a screenshot between chromedriver's coordinate read and dispatch makes the click report success and activate nothing.
- `stop()` waits on an in-flight screencast handshake and never stops a session it did not arm; do not stop on a start-generation mismatch. Why: `#cdpActive` is set at handshake end, so a start in that window reads as none and the stale path tore down the newer recording's session.

## Accepted residuals (not regressions)

- None recorded in this file; topic residuals live in their rule files.
