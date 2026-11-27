# app — design notes and known debt

Owns the dashboard and trace-player UI, served by the backend and by the hosted player (`packages/app/src`).

## Rules

- A zip records no test state; a row's outcome is derived from its rows (`utils/trace-summary.ts`).
- Run start and one entry resetting inside a run share the `clearExecutionData` scope. `ClearExecutionDataWsPayload.runStart` disambiguates on the wire, since popouts see only WS. Don't infer it from uid vs `activeRerunSuiteUid`: that latch outlived its rerun and skipped the next run's wipe. A backend test asserts the flag ships.

## Known debt

- **Live commands arrive in arrival order; bound rows by time, not array index.** Nightwatch flushes native asserts in one batch at test-end, so an array neighbour can be an assert that ran earlier. Order by `(startTime ?? timestamp, sequence ?? 0, index)` in `components/browser/mutation-at-command.ts`. Residual: a submit click whose end, destination birth and next command's start share one millisecond still shows its pre-navigation page; the last row is deliberately unbounded.
- **`#videos` in `snapshot.ts` is only pushed to, so the "Recording N" dropdown accumulates across runs.** Where: `packages/app/src/components/browser/snapshot.ts`. Why unfixed: the component listens only to `screencast-ready` and never learns a run started.
- **`snapshot.ts` is over the file cap.** Next extraction: `#renderBrowserState` and the mutation handlers.
