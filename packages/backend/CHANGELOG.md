# @wdio/devtools-backend

## 1.11.2

### Patch Changes

- a4847ee: Build the dashboard with preact 11, which renders the DOM replay. Raise the `ws` floor to 8.22.0 for every adapter and the backend, and the service's `@babel/traverse` and `@babel/types` floors to 7.29.8. Babel stays on 7: Babel 8 requires Node 22.18 or newer, and the service runs inside WebdriverIO 9 projects that support Node 18.20 and up.
- f49e9f4: Raise the minimum versions of the dashboard server's dependencies: `fastify` to 5.12.5, `@fastify/static` to 10.1.5 and `@fastify/websocket` to 11.3.1. A fresh install already resolves these, but an existing lockfile could keep the older releases the previous ranges allowed.
- Updated dependencies [a4847ee]
- Updated dependencies [dc2ae05]
- Updated dependencies [954faec]
  - @wdio/devtools-app@1.11.2
  - @wdio/devtools-script@1.7.5

## 1.11.1

### Patch Changes

- bde7358: Pass the run-everything command to a rerun child. A child is spawned with one test named on its command line, so an adapter that derives its Run-all command from its own invocation republishes "run that one test" as the command for running everything — after which Run-all reruns only whatever was last reran. The child cannot reconstruct what it was narrowed from, so the spawner now hands the original down alongside the rest of the reuse handshake.
- Updated dependencies [3a36ff0]
- Updated dependencies [f2305b4]
  - @wdio/devtools-app@1.11.1
  - @wdio/devtools-script@1.7.4

## 1.11.0

### Minor Changes

- 1e4a434: Serve the page-side collector at `/api/collector`. Adapters used to locate the collector bundle on disk by walking up for `packages/script/dist/script.js`, which exists only in a monorepo checkout — an adapter installed from a package registry found nothing, and DOM replay silently disappeared while commands, console, network and screencast all kept working.

  The backend now depends on `@wdio/devtools-script` and serves its source, resolved once at startup the same way the app bundle already is. That makes the collector version-matched to the backend by construction rather than pinned separately in every language, and a new adapter needs an HTTP GET instead of its own copy of a 200KB file. Resolution failure throws at startup rather than degrading, matching `getDevtoolsApp`: a backend that cannot hand out the collector is broken, and a silent failure here resurfaces as a mysteriously empty preview panel in whichever adapter connected.

- f8f6ffd: Carry a native mobile session's viewport, capabilities and device into the trace. A native Appium session produced a zip claiming `viewport: 1280x720` and `browserName: chromium` — both the exporter's own fallbacks rather than anything measured. Three separate causes had to be fixed together, because none of them is useful alone.

  The values were never read: the WDIO service skipped its metadata send entirely for a native session, because it resolves the viewport from `window.visualViewport` and a native app has no DOM. It now reads the window off the driver instead (`getWindowSize`, measured at 1080x2219 on a Pixel 7 — the window minus the navigation bar), and degrades to no viewport rather than failing the session if that read is refused.

  Reading them would not have been enough: the capturer's `metadata` — the copy the exporter serializes — was only ever written by the page-side collector's payload, while `sendUpstream` merely transmits. A value resolved on the driver therefore reached a live dashboard and was dropped before the zip. `SessionCapturer.mergeMetadata` now stores as well as publishes, and merges rather than replaces so a later push naming only a url cannot wipe the device.

  And there was nowhere in the zip to put the device: `browserName` is normalized to `chromium` for android/iOS, `platform` names the HOST OS, and the reader rebuilt capabilities as `{ browserName }` alone, so the device survived only as prose inside `title` and every consumer re-derived "was this a phone?" from a heuristic. A `DeviceInfo` type and a single `deviceFromCapabilities` reader now live in shared, the zip states it as a `device` extension field on `context-options` (the same pattern the existing `runner` field uses), and the trace reader narrows it back in and puts the platform back onto the rebuilt capabilities. The naming order is what real hardware requires: `appium:deviceName` then `deviceModel` then `deviceName`, rejecting any candidate that merely repeats the udid — a device cloud reports an Android serial as both `deviceName` and `udid` and the friendly name only in `deviceModel`, while iOS reports a friendly `deviceName` with `udid` separate.

  Because the field is derived in the exporter from capabilities every adapter already sends, Selenium, Nightwatch and the Python adapter gain it with no adapter-side change. The viewport read is per-adapter and remains done only in the WDIO service; Selenium and Nightwatch set no viewport at all today, desktop or native, so their zips still take the exporter's fallback.

  The Metadata tab shows it as a `Device` row (`iPhone 17 (ios 18.1)`), which is all that reads it for now; #347 is the consumer this unblocks, and is what will shape and label the player's frame.

  Note on units, for anything tempted to size a captured image by this viewport: don't. It disagrees with the screenshot on both platforms — Android reports the window without the navigation bar (1080x2219 against a 1080x2400 shot) and iOS reports points rather than pixels (390x844 against 1170x2532). Fit by the image's own decoded dimensions.

### Patch Changes

- afc07ca: Take one DOM capture per action again. Trace mode had grown a second, eager post-action capture beside the pre-action one, with a `readyState` poll and a 250 ms pause on top to hide the fact that the eager one lands while the screen is still moving — so every action paid two captures, and on a native Appium session each capture is two serial round trips. Measured on the native example spec: 15 screenshots and 15 page-source reads against 8 and 8, and a 14.0–14.7 s test against 11.4 s, with the captured frames equivalent.

  The pre-action capture is the one that was right: taken before the command is issued, it is the moment the driver is guaranteed idle, so an action's result is the next action's "before". Only the last action has no successor to hand its result to, so a settle survives in exactly that one place, and it is gated rather than timed — no navigation, no wait. The eager capture, the poll that patched it and the document tag it was built on are deleted. Two related fixes ride along: a row with no capture of its own now replays the latest state at or before it rather than the nearest in absolute distance, which could hand it its successor's; and the screencast poll keeps at most one screenshot outstanding, so it cannot queue ahead of the test's own commands on a serialised driver.

- Updated dependencies [79f9263]
- Updated dependencies [a56c36e]
- Updated dependencies [ae1fd6a]
- Updated dependencies [70f73a8]
- Updated dependencies [f8f6ffd]
- Updated dependencies [01a068c]
- Updated dependencies [993cb61]
- Updated dependencies [70d5260]
  - @wdio/devtools-app@1.11.0
  - @wdio/devtools-script@1.7.3

## 1.10.0

### Minor Changes

- 7fdbe55: The backend ships a runnable entry, so a non-Node adapter can start the dashboard itself.

  - `dist/server.js` is a new CLI entry, exposed as the `devtools-backend` bin. `node packages/backend/dist/server.js` and `npx @wdio/devtools-backend` both start the live dashboard, and `--port` / `--hostname` / `--help` are accepted.
  - `dist/index.js` stays the library entry the JS adapters import in-process. Its "start if run directly" guard is gone rather than repaired: `show-trace.ts` imports `start` from index, which makes index a shared module whose body tsup hoists into `dist/chunk-*.js`, and there `import.meta.url` is the chunk's path and can never equal `process.argv[1]`. The guard was therefore dead in every build, which is why `node dist/index.js` imported a module and exited 0 without serving. A leaf entry keeps its body in its own output file, so the new file needs no guard at all.
  - `dev:app` now runs `dist/server.js`, since it was watching an entry that could not start.

### Patch Changes

- f158645: The published tarball ships `dist` and the README only. Without a `files` field, and with no `.npmignore` in the package, npm was including every `.ts` in `src/` and the whole of `tests/`. That matters now that `npx @wdio/devtools-backend` is a supported entry point rather than an internal dependency.
- c8cf114: Pick up the merged dependency updates for the server's own stack: `@fastify/rate-limit` 10 to 11 and `@fastify/static` 9 to 10, plus `@wdio/cli` 9.28.0 to 9.30.1 and `@wdio/logger` 9.18.0 to 9.29.1. All four are runtime dependencies, so the published ranges only change when the package is released — which matters more than usual now that `npx @wdio/devtools-backend` is a supported entry point and resolves them itself.
- Updated dependencies [c8cf114]
  - @wdio/devtools-app@1.10.1

## 1.9.1

### Patch Changes

- aeb3804: A trace records the same thing whichever runner produced it, and the player reads it back in that runner's own terms.

  **Locators you can paste into your own test.** The accessibility tree and element overlay used to hand back `a*=Logout` to everyone — WebdriverIO syntax, which Selenium's `By.css` and Nightwatch's `'css selector'` both reject. Each trace now carries its runner, and a captured locator is written in that runner's dialect: WebdriverIO keeps its text form, Selenium gets XPath, and Nightwatch prefers a native CSS locator (`button[type="submit"]`) because it is the one runner that reads a bare selector string under a default strategy. Where an XPath locator is genuinely the best available, the A11y panel names the call that resolves it. The player also resolves XPath now, so those rows draw their overlay boxes, and traces recorded before this still resolve their old locators.

  **Rows name the element they acted on.** Selenium consumes a locator at `findElement` and hands back an opaque handle, so its element rows reached the player with nothing to box or mark — no click points at all. Both Selenium and Nightwatch now carry the element's locator onto the row, including for assertions, which name no element of their own: a `node:assert` resolves its target from the value it was given, and a Nightwatch native assert reads it from the call. A page-level read records that its value belongs to no element, so a title assertion cannot inherit the box of an element that happens to read the same text. WebdriverIO stamps the element a command actually acted on rather than the last one resolved, which was wrong whenever two handles were resolved before either was used.

  **Every document instruments itself.** Selenium now registers its page collector at document start over BiDi, as the WebdriverIO and Nightwatch adapters already did, instead of appending a script after each navigation. On a fast two-page form that recovers input events that were being dropped while the collector came up, and anchors destination pages that previously lived and died unrecorded. Nightwatch re-establishes the same instrumentation when it replaces a session mid-run, which also restores network capture that was silently absent for every session after the first.

  **The action tree matches the run.** Nightwatch's `describe/it` interface showed one group for a whole module; each `it` is now its own group. A Cucumber scenario is named instead of showing a generated id, and nests under its feature. A group no longer repeats its parent's name. `traceGranularity: 'session'` covers a whole Nightwatch run rather than only its last browser session, and `'test'` remains the recommendation for Cucumber.

  **Live mode replays the right page.** The player bounded a row's DOM by the next row in arrival order, which is not the next row in time — a Nightwatch native assert, held back until its outcome is known, could bound a row that ran seconds later. Selenium additionally drained the page only at navigation in live mode, leaving nothing to replay between them. Both are fixed; trace-mode replay is unchanged.

  **Fewer swallowed failures.** A screenshot poll landing inside a click could make the click report success while doing nothing; the recorder now stands aside while an input command is in flight. A driver error is no longer mistaken for a probe result, which could put an error object into a screencast frame and lose the run's entire trace at export. A Nightwatch wait that times out produces a row, so the failure appears in the timeline and the Errors tab rather than only in console text, and Cucumber assertions carry a real pass/fail instead of rendering neutral.

- acc22dc: Correctness pass over the dashboard and trace player, driven by a new component-test suite that ran the UI in a real browser for the first time.

  - **DOM replay** now reproduces what the page actually did: a boolean attribute is replayed by presence rather than by value (`checked="false"` no longer replays as checked, and a `disabled="false"` the page set stays disabled), an attribute the page removed replays as removed instead of being recreated empty, a removed `value` empties a field that was never typed into while keeping text that was, and a text-only DOM change is captured and replayed at all.
  - **Trace slices keep their step names**: a per-test slice dropped the metadata its step titles lived under, so every Gherkin step rendered as `stable-…:step:1` instead of its own text.
  - **Network panel**: resource-type dots are coloured for a reconstructed trace, whose HAR reports no MIME type; a request that failed at the transport level reads `ERR` in both the list and the detail card rather than the dash that means "still in flight"; capture, wire and UI now share one request-type vocabulary.
  - **Errors panel** no longer mangles assertion failures — each row is headed by what failed, a multi-line failure stays inside its own bullet, and one failure site is resolved per step.
  - **Compare tab** appears only for the selected test, is windowed to that test's own uid, and keeps its toolbar on one line.
  - **Run state survives a run's worker sockets**, so Preserve & Rerun no longer 409s on every spec but the last, and a dashboard opened mid-run replays the whole run instead of the current spec. Rerun filters also match the runner's own full-title form, so a rerun no longer reports the test as skipped.
  - **Sidebar**: a running test can be stopped, a suite carries no verdict until one of its children settles, a Run All refusal is judged against `canRunAll` and says why, and the selection feeds the selected-test context.
  - **Player**: listeners are torn down on disconnect, the viewport is shown, and the theme is honoured per instance.
  - **Capture**: DOM capture recovers on a document that missed script injection, and Nightwatch cucumber runs now produce traces with native assertions captured.
  - **Empty panels** explain why they are empty instead of drawing a loading skeleton forever.

- Updated dependencies [87a2bad]
- Updated dependencies [aeb3804]
- Updated dependencies [acc22dc]
  - @wdio/devtools-app@1.10.0

## 1.9.0

### Minor Changes

- b28de26: Trace mode: a portable `trace.zip` artifact and first-party `show-trace` player, at parity across WebdriverIO, Selenium, and Nightwatch.

  - **Trace mode** (`mode: 'trace'`) writes a portable artifact under `test-results/` with no dashboard window — `traceFormat` (`zip` | `ndjson-directory`), `traceGranularity` (`session` | `spec` | `test`), and retry-aware `tracePolicy` retention.
  - **Trace player** (`show-trace`): DOM time-travel replayed from the mutation stream, an A11y tab and pick-locator element overlay, a Transcript tab with Copy-for-LLM, Errors/Console/Network/Source panels, and a scrubbable filmstrip timeline.
  - **Per-test artifacts**: `screenshot` and `video` at `traceGranularity: 'test'`, a dense `filmstrip` into the trace, an `emitArtifactsManifest` index for CI, and inline Allure attachment (WebdriverIO + Selenium).
  - **Assertion capture** (`captureAssertions`, on by default): `node:assert` and framework matchers render as trace action rows.

  The trace format and player are identical across all three adapters; capture completeness varies per adapter (see the cross-framework support docs).

### Patch Changes

- Updated dependencies [b28de26]
  - @wdio/devtools-app@1.9.0

## 1.8.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [66309cf]
  - @wdio/devtools-app@1.8.0

## 1.7.0

### Minor Changes

- 93d3851: ### 🚀 Features

  - **Dashboard UI redesign**: port the entire dashboard to the new design mockup — sidebar, header, tabs, and workbench layout align with the updated visual system; theme-adaptive light mode with a segmented toggle.
  - **Timeline & action rail**: new timeline chips, connector rail, and active-row highlighting; action durations color-coded by per-step heat with consistent timing; rail extends across all actions.
  - **Sidebar filtering**: status chips in the sidebar now act as the single-select test filter.
  - **Screencast scrubber**: a scrubber with action markers synced to screencast playback; clicking an action seeks the screencast to that moment.
  - **Network panel redesign**: new layout for the Network tab; added a waterfall view for request timing.
  - **Metadata tab redesign**: collapsible cards replace the flat metadata layout.
  - **Console & Log redesign**: updated layout for the Console and Log tabs; console level filters consolidated into the filter module.
  - **Source panel redesign**: file switcher with call-site context replaces the flat source view.
  - **Compare tab redesign**: updated to match the new design mockup with aligned status markers.
  - **iframe URL mapping**: page URLs now resolve correctly for iframe-hosted pages, and the browser preview frame stays stable across Snapshot/Screencast tabs.

  ### 🐛 Fixes
  - **Baseline command attribution**: assertion commands issued by the framework are now kept with the test that ran them, and preserved baseline commands are attributed by source location.
  - **Automation infobar**: the "Chrome is being controlled by automated test software" infobar is hidden on the dashboard window (service and nightwatch adapters).
  - **Layout polish**: resize-divider line now aligns with the pane boundary; sidebar test-row content and selected-row highlight are evenly spaced.

  ### ⚡ Improvements
  - **Nightwatch PerfLog parsing**: waterfall timing data is now extracted from CDP performance logs for the Network waterfall view.
  - **Console filter consolidation**: console level filters moved to the shared filter module; dead code removed.

### Patch Changes

- Updated dependencies [93d3851]
  - @wdio/devtools-app@1.7.0
