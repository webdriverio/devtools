# packages/selenium-devtools — design notes and known debt

Selenium adapter (`packages/selenium-devtools/src`): selenium-webdriver patching, the NetworkInspector wiring and the JS test-runner hooks.

## Known debt

- **A `wait()` poll is the user's one call, not a row per tick.** The patched `wait()` runs its condition inside an `AsyncLocalStorage` (`wait-tracking.ts` `waitPoll`), which stamps `CapturedCommand.waitScope` on its own polls. `captureOrReplaceCommand` folds a poll only into the row an earlier poll of the same scope made for the same call.
  - Key polls by the nth same call within one condition evaluation (`waitPollOf`), not by command and args: a condition reading `a.getText()` and `b.getText()` otherwise folds the second read over the first.
  - Don't let a wait's rows enter the ordinary retry tracker: a retry would then overwrite the wrong row.
  - Captures run one at a time per capturer, because the driver patcher does not await `onCommand`. Accepted: a library that polls from its own timer shows a row per poll.
- **A wait is one row, and its polls are its children.** The patched `wait()` emits a running row when called (`openWaitRow`) and replaces it by `WaitScope.rowId` at settle; scoped captures get `parentId`. The name comes from `tagElementConditions`, which records each locator in a `WeakMap`. The running row takes no screenshot or drain. The derived promise keeps rejection and `unhandledRejection` behaviour, and element waits are re-wrapped in `WebElementPromise`.
- **Safari delivers a synthesized click only to its frontmost window.** Don't rely on `open -a Safari`: it activates the user's most recent window, which can be their own. On Safari, switch to the session's own window handle before every click, sendKeys, clear and submit (`DriverPatcherHooks.beforeInput`, `focusForInput`). safaridriver reports success either way. The dashboard opens behind via `dashboardLaunchCommand` (`open -n -g`).
- **`DETECTED_RUNNER` shadows the new `Metadata.runner` concept.** Where: `packages/selenium-devtools/src/index.ts`; plugin internals expose it as `detectedRunner`. Why unfixed: the repo-wide rename in `plugin-internals.ts` and `session-lifecycle.ts` is still open.

## File size

- **`packages/selenium-devtools/src/index.ts` is over the file cap.** Session and test-artifact seams are extracted (`test-artifacts.ts`). Remaining: the `PluginInternals` accessor bag and onCommand/onDriverCreated wiring, the next extraction if it grows.
