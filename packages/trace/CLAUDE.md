# trace — design notes and known debt

Owns the pure transforms that turn captured events into trace-zip content, and the zip reader (`packages/trace/src`).

## Known debt

- **Actions that only read the page inherit the preceding action's capture** (`packages/trace/src/trace-frame-snapshots.ts` `claimAfter`). It is non-consuming and falls back to the most recent earlier capture instead of returning nothing, because several actions legitimately share one page state — Nightwatch emits its native assertion rows in a batch whose execution windows collapse onto one instant, and handing the capture to whichever claimed first left the rest of the batch with no DOM, no a11y tree and no screenshot. Nightwatch correspondingly takes **no** capture for an assertion row (`captureAssertCommand`): those rows are emitted at test-end but positioned back on their real execution window, so probing there recorded the page as it was *then* under a timestamp seconds earlier (an assert that ran on `/secure` rendered the `/login` page the test later logged out to).
