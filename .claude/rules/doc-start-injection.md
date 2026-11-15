---
paths:
  - "packages/core/src/{bidi-preload,script-loader}.ts"
  - "packages/script/src/{utils,collector}.ts"
  - "packages/selenium-devtools/src/{session-lifecycle,driverPatcher}.ts"
  - "packages/nightwatch-devtools/src/{session,session-init}.ts"
  - "packages/nightwatch-devtools/src/helpers/{navigationWrap,webdriverHttp}.ts"
---

# Document-start injection

Document-start injection is what removes the whole race class; everything else is reconstruction.

## Rules

- Register the collector with `registerCollectorPreload` (`core/bidi-preload.ts`) via BiDi `script.addPreloadScript` with no browsing-context id, so contexts created later are covered. Why: 0 of 19 rows landed on the wrong DOM (Nightwatch example), against 1 to 5 with `<script>` injection.
- Do not gate Nightwatch's DOM capture on its `bidi` option; `webSocketUrl: true` is the requirement. Why: the option defaults to false and exists to avoid console/network double-reporting; gating on it leaves the race in place for nearly every user.
- Clear `preloadRegistered` and `bidiActive` at session detection (`armReplacedSession`), then re-register. Why: a preload dies with its session, and a stale `bidiActive` kept the perf-log fallback off: 75 network requests in session 1 and 0 in session 2.
- Gate the perf-log fallback on `SessionCapturer.perfLogsRequested` (set from `goog:loggingPrefs.performance`). Why: without the capability each fetch is a failure that prints; iOS Safari went from 257 log lines and 12.3 s to 66 lines and 5.9 s once gated.
- Read the perf log over the raw WebDriver transport (`POST /session/:id/se/log`, `helpers/webdriverHttp.ts`), not `browser.getLog`. Why: a queued `getLog` from the fire-and-forget drain becomes the next command's child and resolves its await early.
- `waitForBody` (`script/src/utils.ts`) checks for the body synchronously before waiting for a frame. Why: on desktop Safari a collector that waited for a frame never anchored; with per-command screenshots off it captured 0 of 8 keystrokes.
- Fallback navigations resolve only once the collector is in the destination: `driverPatcher.ts` `gateNavigation` awaits `afterNavigation`, which injects only when `preloadRegistered` is false. Why: on desktop Safari without a preload, typing finished before the collector landed and the replay showed empty fields.
- The collector's anchor records each form control's live `value` and `checked` (`script/src/utils.ts` `recordFieldState`). Why: `parseNode` reads attributes, which never hold typed text.
- Drain Selenium's navigation before `capturePerformance`'s settle, not after. Why: the drain moves a short-lived destination's anchor out of the page; after the settle the page was gone.

## Accepted residuals (not regressions)

- The first navigation after a Nightwatch session rotation can land before registration and fall back to `<script>` (1 recovery in 3 of 4 runs, 0 in the fourth); Nightwatch exposes no pre-test session hook.
- The fallback path (no BiDi, or `bidi:false`) is lower fidelity: per-action field-state mutations are lost, and a navigating click keeps a ~5 ms residual.
- On the fallback, the anchor is stamped at document birth, so rows before injection replay the state as of injection rather than empty fields.
