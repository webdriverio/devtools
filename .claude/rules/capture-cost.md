---
paths:
  - "packages/core/src/{action-snapshot,capture-timing,driver-activity,screencast,final-frame,finalize-screencast,trace-finalizer}.ts"
  - "packages/core/src/locators/**"
  - "packages/service/src/{index,screencast}.ts"
  - "packages/selenium-devtools/src/{driverPatcher,screencast}.ts"
  - "packages/selenium-devtools/src/helpers/actions-patcher.ts"
  - "packages/nightwatch-devtools/src/helpers/{browserProxy,commandWindow}.ts"
  - "packages/shared/src/action-mapping.ts"
---

# Capture cost

Per-action snapshot cost, native page-source reads, and the filmstrip poller.

## Rules

- Measure with `DEVTOOLS_CAPTURE_TIMING=1` before proposing a capture change; `finalizeTraceExport` (`trace-finalizer.ts`) prints the per-probe table. Why: the split inverts by platform (iOS: page source was 817 of a 938 ms capture).
- Read a native page source through the reader passed to `captureActionSnapshot` (`fromPageSource`). Why: Selenium passes its unpatched original, so the read is never a row of the user's.
- Answer locator uniqueness checks from `withXPathIndex` (`locators/xpath-index.ts`), built once per walk and declining namespaced documents. Why: whole-document XPath checks took 23.5 s on a 752 KB iOS Settings page source.
- Open a Nightwatch command window only for commands known to call back (`helpers/commandWindow.ts`). Why: a builder API or custom command that never calls back holds the driver gate to its bound.
- Open no driver window for waits and host-side commands (`occupiesDriver`, shared `action-mapping.ts`). Why: a `pause` holding the gate blanks the filmstrip.
- Keep one outstanding filmstrip shot (`#pollInFlight`) and the tick-phase `#pollGeneration` checks in `screencast.ts`. Why: a 15 ms command took 4.5 to 7.8 s behind stacked native shots, and a shot orphaned by `stop()` still lands afterwards.
- Drop a skipped filmstrip tick rather than deferring it; poll through a busy driver once the newest frame is `MAX_FILMSTRIP_GAP_INTERVALS` old. Why: reads and waits would otherwise starve the filmstrip.
- Ceiling every awaited driver call in a screencast handshake at `SCREENCAST_HANDSHAKE_TIMEOUT_MS`. Why: a wedged driver otherwise hangs `start()`.
- Open the input window for Selenium's `actions().perform()` in `helpers/actions-patcher.ts`. Why: that call reaches the driver through `execute()`, outside the command hook, so no window would open.

## Accepted residuals (not regressions)

- The driver gate is process-wide: in a multi-session process one session's commands also hold the other's poller off.
- A recorder never stopped stays in the registry and disables frame reuse for the process.
- A reused capture frame still passes `maxBufferFrames` decimation and export thinning.
- Nightwatch's aborted queue after a failed assert strands input windows; for up to 3 s the recorder takes no polled frame.
- Native capture pays the page-source read on every action: 0.75 to 1.2 s on XCUITest even for Settings, against 0.09 to 0.5 s on UiAutomator2. Python takes only the screenshot on a native app, so it has no element list.
