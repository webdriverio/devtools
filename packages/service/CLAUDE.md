# packages/service — design notes and known debt

WebdriverIO service plugin (`packages/service/src`): WDIO hook binding, the command stack, and expect-webdriverio folding.

## Design notes

### One DOM snapshot per action, taken before it

In trace mode the per-action snapshot is captured in `beforeCommand`, stamped at the previous action's end, so every row resolves to a state the driver was idle for. `afterCommand` captures nothing. The last action's snapshot is supplied by `#finalizePerScenario`.

`settleAfterLastAction` is gated, not timed. It waits for `document.readyState === 'complete'` only when the last action navigated to a document the session had not seen (`SessionCapturer.replacedDocumentInLastDrain`). Otherwise it returns at once. Native pauses 250 ms instead.
Don't add an eager post-action capture, a `readyState` poll without that gate, or a document tag: the outgoing document already reports `complete` right after a click, so an ungated poll captures the page the test just left.
Accepted residual: a navigation that has not committed when the anchor is read still reads as "no navigation".

### Command hooks and wait rows

- Hook methods are deliberately not `async`. WDIO keeps one module-global `inCommandHook` flag and skips every command's hooks while any hook runs, so a hook that settles later drops a concurrent command's hooks (the submit click lost its row).
- `command-stack.ts` `CommandStack` opens a level under a wait; its direct children become rows with `parentId`. `wait-rows.ts` `WaitRows` moves a completed wait to the end of `commandsLog`, which keeps the log in completion order.
- An element wait's first hook fires with no arguments, before the wait has issued anything. It is skipped by argument, not by stack.
- Commands the service issues from its own hooks are told apart by `AsyncLocalStorage` (`runAsServiceWork`), not by stack, because a wait's polls carry no spec frame.

## Known debt

- **The per-test `screenshot` and `video` options live on WDIO `ServiceOptions` only.** Putting them on `BaseDevToolsOptions` made them appear available in Selenium and Nightwatch and broke those adapters' `Required<>` option types.
  The policy types and capture/slice logic (`core/screenshot-artifact.ts`, `core/video-slice.ts`) are shared, and Selenium and Nightwatch wire them on their own options. Gated to `traceGranularity:'test'`. Non-Chrome polling floods `@wdio/allure-reporter`: pair it with `disableWebdriverStepsReporting`.
- **expect-webdriverio matchers fold into the value read.** `beforeAssertion` arms a depth-counted pending matcher; `afterAssertion` coalesces the synthesized `expect.<matcher>` row into the read's row, replaced by timestamp, because a top-level read carries no `id`. A matcher that hard-throws is synthesized at `afterTest`/`afterStep` from the throwing read.
  Don't fold a matcher into a read that a wait issued.
  Where: `src/assert-capture.ts` `MATCHER_READ_COMMANDS`, a hand-maintained allowlist. Why unfixed: an unlisted read stays visible beside the `expect.*` row. A synthesized row carries the read's error (`Can't call getText on …`), not an assertion message. Plain jest `expect(x).toBe(y)` fires no hooks, so it has no row.

## File size

Caps are eslint `warn`, not a CI gate.

- `packages/service/src/index.ts` is over the cap. The command-hook family (`beforeCommand`/`afterCommand`/`#commandStack`/`#drainAfterLiveCommand`) is the next extraction; `before()` is also over the function cap.
- `packages/service/src/session.ts` is over the cap (~603 logic lines).

## Test coverage gaps

- `packages/service/src/screencast.ts`: CDP fast-path branches need a real Chrome to exercise.
