// The reasons and labels features.ts cites, kept apart so that file stays the list of features.

export const SAFARI_FOCUS_ONCE =
  'Brings Safari to the front once after the session starts (live mode, local macOS), so a click issued after another window took the front can still land nowhere.'
export const NO_SCREENSHOT_SWITCH =
  'No option: every command row takes a screenshot.'
export const NO_TRACE_FORMAT_TEST =
  "The writer is tested in `packages/trace/tests/trace-exporter.test.ts`; no test covers the adapter handing `traceFormat` on, so check by hand with `traceFormat: 'ndjson-directory'` on the example."
export const NO_HEADLESS_OPTION =
  'No option: set headless in the browser capabilities, as for any run.'
export const WITHOUT_BIDI_ANCHOR =
  'Without BiDi (Safari, Appium) the page collector is injected after each navigation, so a page the test leaves within tens of milliseconds is never captured.'
export const WITHOUT_BIDI_DRAIN =
  'Without BiDi a page the test leaves within tens of milliseconds is never drained, so its requests are not listed.'
export const SELENIUM_JS_FILMSTRIP = 'CDP push (Chromium), polling elsewhere'
export const NETWORK_FLOOR =
  "Fetch and XHR calls carry headers and bodies; every other load comes from the page's Resource Timing buffer, with timing and size but no headers or body, and no status on Safari."
export const NO_CUCUMBER_STEP_RERUN =
  'Under Cucumber a Gherkin step has no CLI filter of its own, so the dashboard reruns scenarios and features, not single steps.'
export const STARTUP_CAPS_ONLY =
  "Decides from the startup capabilities, so a hybrid app's webview half is captured as if it were still native."
