# trace — design notes and known debt

Owns the pure transforms that turn captured events into trace-zip content, and the zip reader (`packages/trace/src`).

## Known debt

- **Actions that only read the page inherit the preceding action's capture.** Where: `packages/trace/src/trace-frame-snapshots.ts` `claimAfter`. It is non-consuming and falls back to the latest earlier capture, because several actions share one page state. Nightwatch's batched assertion rows collapse onto one instant, and handing the capture to the first claimant left the rest with no DOM. Nightwatch takes no capture for an assertion row (`captureAssertCommand`): those rows sit on their real execution window, so probing there records a page seconds stale.
