# @wdio/selenium-devtools

## 1.4.0

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

## 1.3.1

### Patch Changes

- 64d54a9: - Bump @wdio/devtools-core to 1.0.1

## 1.3.0

### Minor Changes

- 66309cf: Add the trace player. `show-trace <trace.zip>` reconstructs a recorded trace and plays it back in the dashboard with a timeline dock, filmstrip, interactive network panel, and keyboard navigation. In trace mode the adapters export a `trace.zip`; the backend reconstructs it and serves it to the player.

### Patch Changes

- Updated dependencies [66309cf]
  - @wdio/devtools-backend@1.8.0

## 1.2.1

### Patch Changes

- cf011cb: ### ⚡ Improvements
  - Add spec-level trace granularity (`TraceGranularity: 'session' | 'spec'`) to all adapters
    - `spec` mode writes one trace per spec file, keyed on filename
    - Actions within each test are wrapped in `Tracing.tracingGroup` spans for proper nesting in trace viewers
    - Fix `lastSelector` bleed-through between consecutive tests
    - Annotate tracing spans with `it()` test names
- Updated dependencies [93d3851]
  - @wdio/devtools-backend@1.7.0
