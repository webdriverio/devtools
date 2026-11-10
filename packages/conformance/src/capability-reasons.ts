// The reasons and labels features.ts cites, kept apart so that file stays the list of features.

export const SAFARI_FOCUS_ONCE =
  'Brings Safari to the front once after the session starts (live mode, local macOS), so a click issued after another window took the front can still land nowhere.'
export const NO_SCREENSHOT_SWITCH =
  'No option: every command row takes a screenshot.'
export const PYTHON_TRACE_READS_NO_SCREENSHOT =
  'Every command row takes a screenshot in live mode; in trace mode a read, wait or lookup takes none and its row shows the capture before it.'
export const NO_TRACE_FORMAT_TEST =
  "The writer is tested in `packages/trace/tests/trace-exporter.test.ts`; no test covers the adapter handing `traceFormat` on, so check by hand with `traceFormat: 'ndjson-directory'` on the example."
export const NO_HEADLESS_OPTION =
  'No option: set headless in the browser capabilities, as for any run.'
export const WITHOUT_BIDI_ANCHOR =
  'Without BiDi (Safari, Appium) the page collector is injected after each navigation, so a page the test leaves within tens of milliseconds is never captured.'
export const WITHOUT_BIDI_DRAIN =
  'Without BiDi a page the test leaves within tens of milliseconds is never drained, so its requests are not listed.'
export const SELENIUM_JS_FILMSTRIP =
  'Chromium streams over CDP; other browsers poll.'
export const NETWORK_FLOOR =
  "Fetch and XHR calls carry headers and bodies; every other load comes from the page's Resource Timing buffer, with timing and size but no headers or body, and no status on Safari."
export const NO_CUCUMBER_STEP_RERUN =
  'Under Cucumber a Gherkin step has no CLI filter of its own, so the dashboard reruns scenarios and features, not single steps.'
export const STARTUP_CAPS_ONLY =
  "Decides from the startup capabilities, so a hybrid app's webview half is captured as if it were still native."
export const TRACE_PATH_INFO_LOG =
  "Logs the path at info level through the adapter's logger rather than printing it, so a run that hides info messages does not show it."
export const PYTHON_TRACE_PATH_LOG =
  "Logs the path (the folder, for per-test traces) at info level through Python's `logging`, which hides info messages unless the run enables them (`--log-cli-level=INFO` under pytest)."
export const NIGHTWATCH_ONE_SLICE_PER_MODULE =
  'Nightwatch fires the global `beforeEach` / `afterEach` once per test module for `describe/it` and exports-object tests, so they collapse to one slice keyed to the first test; Cucumber scenarios get real per-test slices.'
export const SELENIUM_ARTIFACTS_BY_HAND =
  'No test covers the adapter producing and attaching the per-test files; check by hand with `pnpm --filter @wdio/selenium-devtools example:mocha:allure`.'
export const PYTHON_NO_ARTIFACT_OPTIONS =
  'The Python adapter has no `screenshot` / `video` options and no Allure attachment yet.'
export const PYTHON_NO_GHERKIN_GROUPS =
  'The Python adapter stamps no Feature or Step groups, so a pytest-bdd scenario is one flat test group with no Feature parent and no Step children.'
export const NIGHTWATCH_ROW_SCREENSHOT_BY_HAND =
  'No unit test attaches the row screenshot; check the dashboard with `pnpm demo:nightwatch`.'
export const NIGHTWATCH_METADATA_BY_HAND =
  'No test asserts the capabilities in the metadata the adapter sends; check the Metadata tab with `pnpm demo:nightwatch`.'
export const SERVICE_MANIFEST_BY_HAND =
  'No test covers the service turning the manifest on when an Allure reporter is configured; check by hand with one configured.'
