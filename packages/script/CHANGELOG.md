# @wdio/devtools-script

## 1.7.0

### Minor Changes

- b28de26: Trace mode: a portable `trace.zip` artifact and first-party `show-trace` player, at parity across WebdriverIO, Selenium, and Nightwatch.

  - **Trace mode** (`mode: 'trace'`) writes a portable artifact under `test-results/` with no dashboard window — `traceFormat` (`zip` | `ndjson-directory`), `traceGranularity` (`session` | `spec` | `test`), and retry-aware `tracePolicy` retention.
  - **Trace player** (`show-trace`): DOM time-travel replayed from the mutation stream, an A11y tab and pick-locator element overlay, a Transcript tab with Copy-for-LLM, Errors/Console/Network/Source panels, and a scrubbable filmstrip timeline.
  - **Per-test artifacts**: `screenshot` and `video` at `traceGranularity: 'test'`, a dense `filmstrip` into the trace, an `emitArtifactsManifest` index for CI, and inline Allure attachment (WebdriverIO + Selenium).
  - **Assertion capture** (`captureAssertions`, on by default): `node:assert` and framework matchers render as trace action rows.

  The trace format and player are identical across all three adapters; capture completeness varies per adapter (see the cross-framework support docs).
