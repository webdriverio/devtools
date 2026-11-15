# packages/selenium-devtools-py — design notes and known debt

Python adapter (`packages/selenium-devtools-py/src`): pytest plugin and the Python-side capture, rerun and screencast; ships no Node.

## Design notes

Mirrored TypeScript logic and its vectors: `.claude/rules/mirror-vectors.md`.

## Known debt

- **A rerun template selects EITHER by name pattern or by exact id, never both.** `{{testName}}` is regex-escaped (`packages/backend/src/framework-filters.ts` `escapeFilterRegex`). `{{testId}}` is shell-quoted and never escaped: pytest matches nodeids literally, and an escaped nodeid collects nothing and exits 0.
  Where: `packages/shared/src/runner.ts` `RERUN_SLOT`, `packages/backend/src/runner.ts` `#resolveGenericCommand`.
- **Rerun commands come from pytest's own view of its invocation, not from argv.** `src/selenium_devtools/rerun.py` derives them from `pytest_plugin.py` `_configure_rerun`. Capabilities are derived from which commands were built, never declared: an advertised control the backend cannot serve is worse than an absent one.
- **Targeted reruns strip selectors and positionals.** `-k`, `-m`, `--deselect`, `--lf`/`--ff`/`--sw`, `-n` and `--dist` go, or the rerun narrows to nothing. Positionals go too, or each generation runs one test more.
- **Reruns spawn in pytest's rootdir** (`RUNNER_ENV.RUNNER_CWD`, stamped before the backend launches), because a nodeid is rootdir-relative. The variable is replaced on a second `enable()` only while it still holds the value we wrote. Track that value; a boolean "we wrote it" cannot tell whether it is still ours.
- **A spawned rerun must attach to the backend that asked for it.** `backend.py` `reuse_target()` reads `REUSE_ENV` ahead of `DEVTOOLS_PORT`. Otherwise the rerun opens a second dashboard and reads as a run that captured nothing. The window gate lives in `lifecycle.auto_open_enabled()`.
- **A plain script's tree is one synthetic suite holding one synthetic test.** Both denote the whole run, so its launch command doubles as its rerun template (no slot — the backend substitutes nothing) and all three controls are honest. Why: refusing the row-scoped ones would disable the button beside the only row the tree has.
- **A rerun collects a subset, so derive nothing from "this collection" for the merged tree.** Three instances:
  - `SuiteStats.order` is the item's source line, not pytest's collection index.
  - `packages/app/src/controller/suite-merge.ts` `resetStaleChildrenOnRerun` freezes sibling child suites on `activeRerunTestUid`, as `mergeTests` does for tests.
  - The launch command is inherited via `REUSE_ENV.LAUNCH_COMMAND` (`rerun.py` `_inherited_launch`). The rerun template stays locally derived.
- **The screencast runs on its own websocket and must ack every frame.** `cdp_screencast.py` subscribes on a connection separate from the command channel. An unacked frame ends the recording.
  Don't use `driver.start_devtools()`: selenium caches one websocket per driver and hands back the BiDi socket (`Unknown command 'Page.startScreencast'`).
- **Resolve the CDP endpoint from `se:cdp` (Grid) or from `debuggerAddress` → `/json/version` → `webSocketDebuggerUrl` (local chromedriver).** Use stdlib urllib, not selenium's private `_get_cdp_details`. Reject an `se:cdp` equal to `webSocketUrl`: that is the BiDi socket.
- **The screencast buffer thins incoming frames by the stride it halves the buffer by.** `screencast.py` `_buffer` does this; `_keep_tail` folds the newest skipped frame back in at stop, so the video ends where the run did. Don't halve and keep first/last: that drifts to the run's end and drops the middle.
  Test by asserting a middle frame survives, not only the endpoints.
- **Performance timings ride on the command row** (`CommandLog.performance`), re-sent via `send_replace_command` keyed on the row `timestamp`. Don't sleep before reading: that delays the user's test. Discard a read that has no `navigation` entry.
  Read through `_guarded_execute_script`, or the read logs a fake `executeScript` row beside every navigation.
- **Per-command screenshots stop feeding the video while a stream is live.** The pushed frames already cover the timeline; interleaving would duplicate one of them a few milliseconds off.
- **A wait is one row, and its condition's commands nest under it.** `wait_tracking.py` sends the wait's row from the patched `WebDriverWait.until`/`until_not` before the first poll, and replaces it by `id` when the wait returns or raises.
  Rows executed inside the condition take its id as `parentId` (`parent_of`).
  `wait_row_name` names presence and visibility expected conditions `waitForElementLocated`/`waitForElementVisible`, and everything else `wait`. Naming never raises (`_safe_label`, `_safe_row_name`).

## File size

- `packages/selenium-devtools-py/src/selenium_devtools/instrumentation.py` is over the cap. The module-level `_state` bag is read by the snapshot capture, its accessors and the element-scripts handoff, so extraction moves state ownership.
  Per-test frame state already moved to `per_test_capture.py` (`PerTestCapture`); the next change that touches `_state` should split another concern the same way.
