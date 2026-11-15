# core — design notes and known debt

Owns the framework-agnostic capture, reporting and transport logic that the three JS adapters share (`packages/core/src`).

## Design notes

- **A wait is one row named for what it waited for.** It is sent running with `startTime` and no result, then replaced by its numeric `id` at completion. Commands it issued carry that `id` as `CommandLog.parentId`; shared `nestCommands` (`packages/shared/src/command-tree.ts`) builds the tree.
- **A poll that failed under a wait that did not fail is not a failure.** Readers use shared `effectiveFailure` (`packages/shared/src/command-failure.ts`), not `commandFailure`. Under a failed wait, its children keep their errors.
- **BiDi is auto-attached in Service and Selenium.** Nightwatch is opt-in via `bidi: true` plus `webSocketUrl: true` in capabilities.
- **Stamp a row's `timestamp` at COMPLETION and keep invocation as `startTime`.** The page mutation stream is on real time, so an invocation-stamped row replays the page from before its own effect. `collector.captureCurrentDom` stamps `performance.timeOrigin`, not the drain clock.
- **Live mode drains the collector after any command that could move the page.** Not only at navigation: the nav hook is deferred behind injection and a settle. Selenium's drain is serialized on a tail because the driver patcher does not await `onCommand`; an overtaken batch strands every later row.
- **`reattributeDomAnchors` (`packages/trace/src/trace-mutations.ts`) only pulls an anchor born after the last logged command, and only when no later command completed.** Pulling anchors earlier otherwise steals the new page's DOM from rows still on the old one. It is also never pulled earlier than the newest timestamp already in the stream (`floor`).
- **Accepted residual: Nightwatch `click` resolves before its navigation commits.** A submit-click row can show the pre-navigation page. Every heuristic tried regressed another row; don't add one.
- **Every per-action snapshot probe is timeout-guarded** (`core/action-snapshot.ts` `probe`, `SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS`). Nightwatch's `browser.getCurrentUrl()`/`getTitle()` are queued and hang inside the command hook; probe over `helpers/webdriverHttp.ts` instead.
  `runWith` treats a `null` script result as its fallback, because a driver answering `null` would otherwise lose the whole snapshot.
- **`filmstrip` lives on `BaseDevToolsOptions`.** All three adapters implement it. Finalize contexts must spread `[...accumulated, ...live recorder frames]`, or a mid-run slice is blank. Dense frames supersede the sparse per-action filmstrip.
- **Per-test Allure attach goes through `core/allure-artifacts.ts` `AllureAttachSink`.** An undefined sink means produce-only. Selenium's runner hooks must be awaited, or the attach lands on the next test.
- **Run identity is env-propagated.** Every worker socket carries `?runId=` from `core/run-id.ts` `resolveRunId()` (`WORKER_WS_QUERY`). WDIO stamps it in `onPrepare`, so all workers agree.
  Don't derive it from `process.ppid`: two sequential single-process runs would share an id and inherit each other's state.
- **The replayed DOM is masked; the rest of the trace is a full record of the run.** `maskInputs` (password fields, default on) and `maskSelectors` on the JS adapters (`packages/shared/src/types.ts` `BaseDevToolsOptions`, applied by `packages/script/src/masking.ts`).
  Python: `mask_inputs`/`mask_selectors`, env `DEVTOOLS_MASK_INPUTS`/`DEVTOOLS_MASK_SELECTORS` (`packages/selenium-devtools-py/src/selenium_devtools/constants.py`).
  Debt: screenshots, filmstrip frames and network response bodies (`packages/script/src/collectors/networkRequests.ts`) are unmasked. Typed command args stay unmasked by design (`types.ts` `maskInputs` doc). Treat a zip as sensitive as the run; `shared/src/element-scripts.ts` dropping `value`/`href` is pruning, not redaction.
- **`ActionSnapshot` carries no session identity.** Resolution is by completion timestamp, so a same-millisecond tie across concurrent sessions in one process can pick the wrong capture.

## Known debt

- **`replaceCommand` has two semantics.** Selenium mutates in place and keeps `_id`/`id` for chained calls; Nightwatch splices and reissues.
  Where: `packages/selenium-devtools/src/session.ts`, `packages/nightwatch-devtools/src/session.ts`. Why unfixed: runner integrations differ, so storage stays adapter-specific.
- **Retry-aware retention reads one ledger, and it degrades for Nightwatch.** `core/attempt-tracker.ts` `TestAttemptTracker` is keyed by the retry-stable uid; `packages/trace/src/trace-retention.ts` groups by test.
  Nightwatch `--retries` re-runs internally with no attempt field, so only the final attempt is seen and the policies other than `retain-on-failure` degrade. WDIO `specFileRetries` spawns workers the process-scoped ledger cannot see.
  Why unfixed: the attempt data lives only in undocumented Nightwatch internals.
- **Multi-process parallel runs get one run id per worker in Selenium and Nightwatch.** jest/vitest workers and `test_workers` have no launcher hook to stamp first, so each worker reads as a new run.
  Where: `core/run-id.ts`. Why unfixed: no launcher-side hook exists for these runners.
- **`ActionSnapshot` session identity is a shared-contract change.** Where: `core/action-snapshot.ts`, `packages/trace/src/trace-frame-snapshots.ts`. Why unfixed: fixing it needs `sessionId` on the snapshot and a keyed index; the failure needs threaded drivers in one process to hit.
- **Nightwatch inline Allure attach is unsupported.** Where: `packages/nightwatch-devtools`. Why unfixed: `nightwatch-allure` is post-hoc and `allure-js-commons` no-ops in a Nightwatch run; revisit if a runtime adapter appears.
- **`restoreBrowserFocus` (`core/browser-focus.ts`, `open -a Safari`) can focus the user's own Safari window.** WDIO and Nightwatch still call it once after bring-up in live mode; Selenium switches the window handle per input.
  Why unfixed: the per-input switch is not ported. Python's `restore_browser_focus` (`packages/selenium-devtools-py/src/selenium_devtools/device.py`) is not checked for this.
