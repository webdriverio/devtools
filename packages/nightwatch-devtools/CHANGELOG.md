# @wdio/nightwatch-devtools

## 1.7.1

### Patch Changes

- c8cf114: Pick up the merged `yazl` 2 to 3 update, the library the trace zip is written with. It is a runtime dependency, so the published range only changes when the package is released.
- 917ff3b: Replay the last field a test fills before it submits, and the page it navigates to. Two ordering faults met here. The post-command collector drain captures the outgoing page's field edits, and it has to reach the driver before the next queued command or those edits die with the document the submit navigates away from; it was issued last, behind the action-snapshot probes and the screenshot, so it took about 130 ms to complete when the navigation left it only 18 ms, and the password fill replayed as an empty box. The drain is now the first request issued when a DOM-mutating command completes, and runs ahead of the performance-log read inside `captureTrace`.

  That alone lost the destination page, because nothing else was really anchoring it: `anchorAfterNavigation` waited for the collector to go MISSING, and under the document-start preload every document instruments itself, so that signal is permanently false. The destination had only ever been anchored by a drain slow enough to land after the navigation. It now waits for the document's own `performance.timeOrigin` to change, which is the same clock a DOM anchor is stamped with, so a replacement is detected whatever the latency and a same-URL re-navigation counts too. The destination anchor is also issued after the row's screenshot and DOM snapshot rather than ahead of them.

- Updated dependencies [7fdbe55]
- Updated dependencies [f158645]
- Updated dependencies [c8cf114]
- Updated dependencies [4993f4a]
  - @wdio/devtools-backend@1.10.0
  - @wdio/devtools-script@1.7.2

## 1.7.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [aeb3804]
- Updated dependencies [acc22dc]
  - @wdio/devtools-backend@1.9.1
  - @wdio/devtools-script@1.7.1

## 1.6.0

### Minor Changes

- b28de26: Trace mode: a portable `trace.zip` artifact and first-party `show-trace` player, at parity across WebdriverIO, Selenium, and Nightwatch.

  - **Trace mode** (`mode: 'trace'`) writes a portable artifact under `test-results/` with no dashboard window — `traceFormat` (`zip` | `ndjson-directory`), `traceGranularity` (`session` | `spec` | `test`), and retry-aware `tracePolicy` retention.
  - **Trace player** (`show-trace`): DOM time-travel replayed from the mutation stream, an A11y tab and pick-locator element overlay, a Transcript tab with Copy-for-LLM, Errors/Console/Network/Source panels, and a scrubbable filmstrip timeline.
  - **Per-test artifacts**: `screenshot` and `video` at `traceGranularity: 'test'`, a dense `filmstrip` into the trace, an `emitArtifactsManifest` index for CI, and inline Allure attachment (WebdriverIO + Selenium).
  - **Assertion capture** (`captureAssertions`, on by default): `node:assert` and framework matchers render as trace action rows.

  The trace format and player are identical across all three adapters; capture completeness varies per adapter (see the cross-framework support docs).

### Patch Changes

- Updated dependencies [b28de26]
  - @wdio/devtools-backend@1.9.0
  - @wdio/devtools-script@1.7.0

## 1.5.1

### Patch Changes

- 64d54a9: - Bump @wdio/devtools-core to 1.0.1

## 1.5.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [66309cf]
  - @wdio/devtools-backend@1.8.0

## 1.4.0

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

- cf011cb: ### ⚡ Improvements
  - Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
    - `spec` mode writes one trace per spec file, keyed on filename
    - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
    - Fix `lastSelector` bleed-through between consecutive tests
    - Annotate tracing spans with `it()` test names
- Updated dependencies [93d3851]
  - @wdio/devtools-backend@1.7.0
