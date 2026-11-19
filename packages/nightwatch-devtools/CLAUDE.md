# packages/nightwatch-devtools — design notes and known debt

Nightwatch adapter (`packages/nightwatch-devtools/src`): plugin hooks, the queued-command proxy and the Nightwatch BDD and cucumber lifecycles.

## Known debt

- **A low filmstrip count across `browser.end()` is usually dedup, not frame loss.** Byte-identical frames are thinned by `packages/trace/src/screencast-trace.ts` `thinScreencastFrames`, so a blinking caret can collapse. Check a sha1 histogram of the emitted events before calling it loss.
  `#emitTestArtifacts` must not read `recorder?.frames ?? filmstripFrames`: once a recorder exists, that drops every frame from before a session change.
- **Eager per-test slice can drop an action snapshot still in flight.** Its fire-and-forget capture may not resolve before `afterEach` or scenario end, and the slice is written from whatever exists at flush time. The WDIO service avoids this by awaiting each snapshot inline before the flush.
- **One `SessionCapturer` per RUN, not per WebDriver session.** A replaced session re-targets the capturer (`setBrowser` in `src/session.ts`) and re-arms it (`armReplacedSession`, `rotateScreencastForSession` in `src/session-init.ts`). It is never rebuilt, or cucumber `traceGranularity:'session'` keeps only the last scenario.
  Call the guarded helpers from both detectors (`needsCaptureRearm`, the `screencastRotation` latch). A hand-rolled body at the second call site re-arms a session the hook already armed.
  `metadata` stays single-valued (last session). Don't freeze it at the first session: that changes the sessionId in every per-test slice.
- **Nav injection must not ride on a queued `perform()`.** Nightwatch aborts the remaining queue when a test fails, discarding the callback. Hang injection off the command's own thenable, and return `result` unchanged so `browser.url(…).waitFor…()` chaining still works.
- **The page-side drain and probes go over `helpers/webdriverHttp.ts`, never through `browser.*`.** Those are queued commands. The immediate drain captures the outgoing page's edits.
  A second drain, `session.ts` `anchorAfterNavigation`, polls for the collector to disappear and then anchors the destination with a forced drain, because a click resolves before its navigation commits. It is tracked in `snapshotCaptures`. Residual: a submit click can still show the pre-navigation page; every heuristic tried regressed another row, so don't add one.
- **A failing wait needs a row.** `waitForElement*` is normalized onto the WDIO wait methods in `ACTION_MAP`. A wait whose result is `false` is a timeout; that reading is scoped to waits because `false` is legitimate for `isDisplayed`. Derivation: shared `commandFailure` (`packages/shared/src/command-failure.ts`).
- **Wait parenting is an `AsyncLocalStorage` scope, not a stack.** `waitUntil` and `waitForElement*` open rows through `SessionCapturer.openCommand`. `helpers/waitRows.ts` scopes each poll, so anything that merely ran while a wait was open is not parented to it.
  `waitForElement*` polls through Nightwatch's element transport, so it has no children. Residual: an un-awaited `waitUntil` chained behind queued commands shows as running early.
  A `waitUntil` condition is never taken for a result callback.
- **`browser.url()` with no argument is a getter, not a navigation.** The nav proxy gates on a string first argument.
- **Nightwatch command failures arrive as callback results, not throws.** Only a synchronous failure reaches the `try/catch`. `helpers/browserProxy.ts` `callbackError` unwraps the W3C `value` wrapper and promotes it to the row's `error`. A result carrying `passed` is an assertion outcome and is not reinterpreted.
- **Row order comes from `CommandLog.sequence`, not the millisecond clock.** It is stamped when the test issues the row, and `packages/trace/src/trace-action-events.ts` `buildActionEvents` uses it as the tiebreak. `results.commands` is empty for BDD, so Nightwatch's own timings are unavailable.
- **Native asserts are buffered and emitted at test end.** Streaming mid-run would paint every assert green before its outcome is known. Reconcile against `results.testcases[*].assertions`: the flat `results.assertions` holds only the last testcase. `actual` is parsed from `but got:` on failures.
- **BDD and exports-object interfaces collapse per-test trace to one slice.** The plugin's `beforeEach`/`afterEach` fire once per module, so `traceGranularity:'test'` keys a single slice to the first test. With a passing first test and a failing later one, `retain-on-failure` drops the trace and video.
  Why unfixed: no per-`it` hook is reachable from the plugin. Cucumber scenarios do get per-test slices.
- **Cucumber capture needs three pieces.**
  - `packages/nightwatch-devtools/tsup.config.ts` must build `src/helpers/cucumberHooks.cts` as a self-contained CJS entry; without it Cucumber registers no hooks and nothing is captured. `PLUGIN_GLOBAL_KEY` stays in the leaf `plugin-global-key.ts`: importing `constants.ts` pulls core's `import.meta.url`, which throws under CJS.
  - Capture runs in a pre-quit `After` (`order:1000`). The `order:-1` finalize runs after browser quit, when there is no `sessionId`. This requires `traceGranularity:'test'`.
  - Cucumber's client has no reporter, so `results.*` is never populated. `helpers/nativeAssertions.ts` `observedAssertOutcome` reads the outcome from the assertion's promise. A fulfilment of `undefined` stays neutral: that is an assertion that never ran.
  - The native-assert buffer is per test unit (`resetTestTracking` at `wrapBrowserOnce`), not per step.
- **The cucumber screencast poller logs `socket hang up` warnings.** It keeps issuing `/screenshot` into the session Nightwatch quits per scenario. Fix: stop the recorder before the quit.
- **Assert target comes from the call.** `helpers/assertTarget.ts` is an allowlist transcribed from Nightwatch's own assertion signatures. Don't use a "first string argument" heuristic: `title*`/`url*` and node:assert mirrors take a plain value first.

## File size

Caps are eslint `warn`, not a CI gate.

- `packages/nightwatch-devtools/src/index.ts` is over the cap. The remainder is the declarative `PluginInternals` accessor bag plus delegators and the factory; accepted as is.
- `packages/nightwatch-devtools/src/session.ts` is over the cap (~547 logic lines). `captureNetworkFromPerformanceLogs` and `drainCollector` are coupled to Nightwatch browser state; extracting them means rewriting that coupling.

## Test coverage gaps

- `packages/nightwatch-devtools/src/session.ts`: `takeScreenshotViaHttp` error branches need a real WebDriver.
