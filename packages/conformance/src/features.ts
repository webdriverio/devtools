// Every user-facing feature and what each adapter does with it; see CONTRIBUTING.md "Adding a feature".

import {
  ACTION_RULES,
  ADAPTER_TESTS,
  DOM_RULES,
  FAILED_TEST_RULES,
  NETWORK_RULES,
  allCovered,
  allTested,
  byHand,
  covered,
  partial,
  tested,
  unsupported
} from './capability-helpers.js'
import { RULES } from './constants.js'
import type { Feature } from './types.js'

const WDIO = ADAPTER_TESTS['devtools-service']
const SELENIUM = ADAPTER_TESTS['selenium-devtools']
const NIGHTWATCH = ADAPTER_TESTS['nightwatch-devtools']
const PYTHON = ADAPTER_TESTS['selenium-devtools-py']

const SAFARI_FOCUS_ONCE =
  'Brings Safari to the front once after the session starts (live mode, local macOS), so a click issued after another window took the front can still land nowhere.'
const NO_SCREENSHOT_SWITCH = 'No option: every command row takes a screenshot.'
const NO_TRACE_FORMAT_TEST =
  "The writer is tested in `packages/trace/tests/trace-exporter.test.ts`; no test covers the adapter handing `traceFormat` on, so check by hand with `traceFormat: 'ndjson-directory'` on the example."
const NO_HEADLESS_OPTION =
  'No option: set headless in the browser capabilities, as for any run.'
const WITHOUT_BIDI_ANCHOR =
  'Without BiDi (Safari, Appium) the page collector is injected after each navigation, so a page the test leaves within tens of milliseconds is never captured.'
const WITHOUT_BIDI_DRAIN =
  'Without BiDi a page the test leaves within tens of milliseconds is never drained, so its requests are not listed.'
const SELENIUM_JS_FILMSTRIP = 'CDP push (Chromium), polling elsewhere'
const NETWORK_FLOOR =
  "Fetch and XHR calls carry headers and bodies; every other load comes from the page's Resource Timing buffer, with timing and size but no headers or body, and no status on Safari."
const NO_CUCUMBER_STEP_RERUN =
  'Under Cucumber a Gherkin step has no CLI filter of its own, so the dashboard reruns scenarios and features, not single steps.'
const STARTUP_CAPS_ONLY =
  "Decides from the startup capabilities, so a hybrid app's webview half is captured as if it were still native."
// appium-interceptor is an Android plugin; iOS app traffic needs a device or proxy capture outside the adapters.
const onAndroid = (path: string) => covered(path, 'Android')
const NEEDS_APPIUM_WEB = (demo: string) =>
  `Needs an Appium device; check by hand with \`DEVTOOLS_MOBILE=web pnpm ${demo}\`.`
const NEEDS_IOS = (demo: string) =>
  `Needs a booted iOS simulator; check by hand with \`DEVTOOLS_MOBILE_PLATFORM=ios pnpm ${demo}\`.`

export const FEATURES = [
  {
    id: 'trace-mode',
    name: 'Trace mode + `show-trace` player',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}trace-action-capture.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}trace-granularity.test.ts`),
      'nightwatch-devtools': covered(`${NIGHTWATCH}traceSlices.test.ts`),
      'selenium-devtools-py': covered(`${PYTHON}test_trace_export.py`)
    }
  },
  {
    id: 'dom-time-travel',
    name: 'DOM time-travel (mutation capture)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': tested(DOM_RULES),
      'selenium-devtools': partial(WITHOUT_BIDI_ANCHOR, 'with BiDi'),
      'nightwatch-devtools': partial(WITHOUT_BIDI_ANCHOR, 'with BiDi'),
      'selenium-devtools-py': tested(DOM_RULES)
    }
  },
  {
    id: 'network-requests',
    name: 'Network requests (browser sessions)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': tested(NETWORK_RULES),
      'selenium-devtools': partial(WITHOUT_BIDI_DRAIN, 'with BiDi'),
      'nightwatch-devtools': partial(
        "Without BiDi (`bidi: true`) or Chrome's performance log (`goog:loggingPrefs`), a page the test leaves within tens of milliseconds is never drained, so its requests are not listed.",
        'with BiDi'
      ),
      'selenium-devtools-py': tested(NETWORK_RULES)
    }
  },
  {
    id: 'filmstrip',
    name: 'Screencast (`filmstrip` / video)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(
        `${WDIO}screencast.test.ts`,
        'CDP push (Chrome), polling elsewhere'
      ),
      'selenium-devtools': covered(
        `${SELENIUM}screencast.test.ts`,
        SELENIUM_JS_FILMSTRIP
      ),
      'nightwatch-devtools': partial(
        'Nightwatch exposes no stable CDP handle, so frames come from a `takeScreenshot` poll every 200 ms.',
        'polling only'
      ),
      'selenium-devtools-py': covered(
        `${PYTHON}test_cdp_screencast.py`,
        'CDP push (Chromium), one frame per command elsewhere'
      )
    }
  },
  {
    id: 'per-test-granularity',
    name: "Per-test granularity (`traceGranularity: 'test'`)",
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}trace-granularity.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}trace-granularity.test.ts`),
      'nightwatch-devtools': partial(
        'Nightwatch fires the global `beforeEach` / `afterEach` once per test module for `describe/it` and exports-object tests, so they collapse to one slice keyed to the first test; Cucumber scenarios get real per-test slices.'
      ),
      // The Python adapter ships no Node; the backend slices its run per test.
      'selenium-devtools-py': covered(
        'packages/backend/tests/trace-slice.test.ts'
      )
    }
  },
  {
    id: 'retry-retention',
    name: 'Retry-aware retention (`tracePolicy`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}trace-granularity.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}attempt-capture.test.ts`),
      'nightwatch-devtools': partial(
        'For `describe/it` and exports-object tests, `--retries` reruns a testcase internally without firing the per-test hooks again, so the other policies behave like `retain-on-failure`; Cucumber scenarios record every attempt.',
        '`retain-on-failure` only'
      ),
      'selenium-devtools-py': partial(
        'Nothing the Python adapter sends carries an attempt number, so the retry-aware policies behave like `retain-on-failure`.',
        '`retain-on-failure` only'
      )
    }
  },
  {
    id: 'per-test-artifacts',
    name: 'Per-test `screenshot` / `video`, attached to Allure',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}screencast-lifecycle.test.ts`),
      'selenium-devtools': byHand(
        'No test covers the adapter producing and attaching the per-test files; check by hand with `pnpm --filter @wdio/selenium-devtools example:mocha:allure`.'
      ),
      'nightwatch-devtools': partial(
        'Nightwatch has no live Allure attach API, so per-test screenshots and videos are written to disk and listed in the manifest but not attached.',
        'produce-only'
      ),
      'selenium-devtools-py': unsupported(
        'The Python adapter has no `screenshot` / `video` options and no Allure attachment yet.'
      )
    }
  },
  {
    id: 'cucumber-nesting',
    name: 'Cucumber Feature→Scenario→Step nesting',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': partial(
        'The service records no feature ancestry for a scenario, so the trace nests Scenario→Step.',
        'Scenario→Step'
      ),
      'selenium-devtools': covered(`${SELENIUM}index.test.ts`),
      'nightwatch-devtools': partial(
        'Nightwatch steps are not stamped as nested groups, so the trace nests Feature→Scenario.',
        'Feature→Scenario'
      ),
      'selenium-devtools-py': unsupported(
        'The Python adapter stamps no Feature or Step groups, so a pytest-bdd scenario is one flat test group with no Feature parent and no Step children.'
      )
    }
  },
  {
    id: 'assertion-capture',
    name: 'Assertion capture (`captureAssertions`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}assert-capture.test.ts`),
      'selenium-devtools': partial(
        '`node:assert` rows pass and fail; jest-style `expect()` and chai produce no rows at all, and a failing matcher only marks its test failed.',
        '`node:assert` only'
      ),
      'nightwatch-devtools': partial(
        "`assert.*`, `verify.*` and `node:assert` rows pass and fail; Nightwatch's `expect` API produces no rows.",
        'no `expect`'
      ),
      'selenium-devtools-py': covered(`${PYTHON}test_assertions.py`)
    }
  },
  {
    id: 'auto-bidi',
    name: 'BiDi console / network capture',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': byHand(
        'No test covers the service attaching BiDi by itself; check by hand with `pnpm demo:wdio`.',
        'auto'
      ),
      'selenium-devtools': byHand(
        'No test covers `webSocketUrl` being set on the Builder and BiDi attached; check by hand with `pnpm demo:selenium`.',
        'auto'
      ),
      'nightwatch-devtools': partial(
        'Nightwatch turns it on with `bidi: true` plus `webSocketUrl: true` in the capabilities.',
        'opt-in'
      ),
      'selenium-devtools-py': covered(
        `${PYTHON}test_instrumentation.py`,
        'auto'
      )
    }
  },
  {
    id: 'a11y-overlay',
    name: 'A11y tab + pick-locator overlay (trace player)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}action-snapshot.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}action-snapshot.test.ts`),
      'nightwatch-devtools': covered(
        `${NIGHTWATCH}actionSnapshotDialect.test.ts`
      ),
      'selenium-devtools-py': covered(`${PYTHON}test_a11y_elements.py`)
    }
  },
  {
    id: 'transcript',
    name: 'Transcript + Copy-for-LLM (trace player)',
    tables: ['readme-trace', 'cross-framework'],
    cells: allCovered('packages/trace/tests/trace-transcript.test.ts')
  },
  {
    id: 'actions-list',
    name: 'One row per command in the Actions list',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allTested(ACTION_RULES)
  },
  {
    id: 'wait-rows',
    name: 'Waits show as one row with what they issued nested under it',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      ...allTested([RULES.waitParentsItsRows]),
      'nightwatch-devtools': partial(
        'A `waitUntil` row holds the commands its condition issued; a `waitForElement*` row has nothing under it, because Nightwatch polls for the element through its own transport rather than `browser`.',
        'no element-wait polls'
      )
    }
  },
  {
    id: 'command-screenshots',
    name: 'Screenshot on every command row',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}session.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}teardown-settle.test.ts`),
      'nightwatch-devtools': byHand(
        'No unit test attaches the row screenshot; check the dashboard with `pnpm demo:nightwatch`.'
      ),
      'selenium-devtools-py': covered(`${PYTHON}test_instrumentation.py`)
    }
  },
  {
    id: 'console-logs',
    name: 'Browser console logs',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}session.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}session.test.ts`),
      'nightwatch-devtools': covered(`${NIGHTWATCH}session.test.ts`),
      'selenium-devtools-py': covered(`${PYTHON}test_bidi.py`)
    }
  },
  {
    id: 'source-tab',
    name: 'Source tab opens the test line that ran the command',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allTested([RULES.callSiteInScenario])
  },
  {
    id: 'metadata-tab',
    name: 'Metadata tab (session, capabilities, device)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': covered(`${WDIO}session-metadata.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}driverMetadata.test.ts`),
      'nightwatch-devtools': byHand(
        'No test asserts the capabilities in the metadata the adapter sends; check the Metadata tab with `pnpm demo:nightwatch`.'
      ),
      'selenium-devtools-py': covered(`${PYTHON}test_instrumentation.py`)
    }
  },
  {
    id: 'performance-timings',
    name: 'Performance timings on navigation rows',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allTested([RULES.navigationTimings])
  },
  {
    id: 'failed-command-errors',
    name: "Failed command in the Errors tab, with the browser's message",
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allTested(FAILED_TEST_RULES)
  },
  {
    id: 'run-controls',
    name: 'Run, Rerun and Run all from the dashboard',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': partial(
        NO_CUCUMBER_STEP_RERUN,
        'no Cucumber step rerun'
      ),
      'selenium-devtools': partial(
        NO_CUCUMBER_STEP_RERUN,
        'no Cucumber step rerun'
      ),
      'nightwatch-devtools': partial(
        NO_CUCUMBER_STEP_RERUN,
        'no Cucumber step rerun'
      ),
      // pytest has no Gherkin steps to rerun.
      'selenium-devtools-py': covered(`${PYTHON}test_rerun.py`)
    }
  },
  {
    id: 'preserve-rerun',
    name: 'Preserve & Rerun (compare a failed run with its rerun)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allCovered('packages/backend/tests/preserve-across-rerun.test.ts')
  },
  {
    id: 'dashboard-window',
    name: 'Dashboard window opens by itself in live mode, and can be turned off',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': partial(
        'The service always opens the dashboard in live mode; `devtoolsCapabilities` picks its browser but cannot skip it.',
        'always opens'
      ),
      'selenium-devtools': byHand(
        'No unit test asserts the window stays shut; check by hand with `openUi: false` on the Selenium example.',
        '`openUi: false`'
      ),
      'nightwatch-devtools': partial(
        'Nightwatch always opens the dashboard in live mode.',
        'always opens'
      ),
      'selenium-devtools-py': covered(
        `${PYTHON}test_lifecycle.py`,
        '`DEVTOOLS_OPEN=0`'
      )
    }
  },
  {
    id: 'screenshot-switch',
    name: 'Turn off per-command screenshots (`captureScreenshots`)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': unsupported(
        'No option: every command row takes a screenshot, except on Appium, where only native sessions in live mode do.'
      ),
      'selenium-devtools': byHand(
        'No unit test asserts that `captureScreenshots: false` skips the row screenshot; check on the Selenium example.'
      ),
      'nightwatch-devtools': unsupported(NO_SCREENSHOT_SWITCH),
      'selenium-devtools-py': unsupported(NO_SCREENSHOT_SWITCH)
    }
  },
  {
    id: 'headless',
    name: 'Force the test browser headless (`headless`)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': unsupported(NO_HEADLESS_OPTION),
      'selenium-devtools': partial(
        'The option adds `--headless=old` to `goog:chromeOptions` only, so other browsers stay headed; set their own headless capability.',
        'Chrome only'
      ),
      'nightwatch-devtools': unsupported(NO_HEADLESS_OPTION),
      'selenium-devtools-py': unsupported(NO_HEADLESS_OPTION)
    }
  },
  {
    id: 'safari-focus',
    name: 'Safari kept frontmost so input lands (live mode)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': partial(SAFARI_FOCUS_ONCE, 'once'),
      'selenium-devtools': byHand(
        'No test covers the Safari window switch before an input; check live on desktop Safari.',
        'before each element input'
      ),
      'nightwatch-devtools': partial(SAFARI_FOCUS_ONCE, 'once'),
      'selenium-devtools-py': partial(SAFARI_FOCUS_ONCE, 'once')
    }
  },
  {
    id: 'trace-format',
    name: "Unpacked trace output (`traceFormat: 'ndjson-directory'`)",
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': byHand(NO_TRACE_FORMAT_TEST),
      'selenium-devtools': byHand(NO_TRACE_FORMAT_TEST),
      'nightwatch-devtools': byHand(NO_TRACE_FORMAT_TEST),
      'selenium-devtools-py': unsupported(
        'The Python adapter has no option for it and sends no format in its export request, so the backend writes a zip.',
        'zip only'
      )
    }
  },
  {
    id: 'artifacts-manifest',
    name: 'Artifacts manifest for CI and reporters (`emitArtifactsManifest`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': byHand(
        'No test covers the service turning the manifest on when an Allure reporter is configured; check by hand with one configured.'
      ),
      'selenium-devtools': covered(`${SELENIUM}attempt-capture.test.ts`),
      'nightwatch-devtools': partial(
        'Nightwatch has no live Allure signal to turn the manifest on by itself, so it stays opt-in.',
        'opt-in'
      ),
      'selenium-devtools-py': unsupported(
        'The Python adapter writes no artifacts manifest.'
      )
    }
  },
  {
    id: 'network-without-bidi',
    name: 'Network without BiDi (Safari, Appium mobile browsers)',
    tables: ['readme-trace', 'readme-mobile', 'cross-framework', 'mobile'],
    cells: {
      'devtools-service': partial(NETWORK_FLOOR),
      'selenium-devtools': partial(NETWORK_FLOOR),
      'nightwatch-devtools': partial(NETWORK_FLOOR),
      'selenium-devtools-py': partial(NETWORK_FLOOR)
    }
  },
  {
    id: 'mobile-browser',
    name: 'Mobile browser sessions (Chrome on Android, Safari on iOS)',
    tables: ['readme-mobile', 'mobile'],
    cells: {
      'devtools-service': covered(`${WDIO}session.test.ts`),
      'selenium-devtools': byHand(NEEDS_APPIUM_WEB('demo:selenium:mobile')),
      'nightwatch-devtools': byHand(NEEDS_APPIUM_WEB('demo:nightwatch:mobile')),
      'selenium-devtools-py': byHand(NEEDS_APPIUM_WEB('demo:python:mobile'))
    }
  },
  {
    id: 'ios',
    name: 'iOS (XCUITest): native apps and Safari',
    tables: ['readme-mobile', 'mobile'],
    cells: {
      'devtools-service': byHand(NEEDS_IOS('demo:wdio:mobile')),
      'selenium-devtools': byHand(NEEDS_IOS('demo:selenium:mobile')),
      'nightwatch-devtools': byHand(NEEDS_IOS('demo:nightwatch:mobile')),
      'selenium-devtools-py': byHand(NEEDS_IOS('demo:python:mobile'))
    }
  },
  {
    id: 'native-detected',
    name: 'Native session detected, page-side capture skipped',
    tables: ['readme-mobile', 'mobile'],
    cells: {
      'devtools-service': covered(`${WDIO}session.test.ts`),
      'selenium-devtools': covered(`${SELENIUM}session.test.ts`),
      'nightwatch-devtools': covered(`${NIGHTWATCH}native-session.test.ts`),
      'selenium-devtools-py': covered(`${PYTHON}test_device.py`)
    }
  },
  {
    id: 'hybrid-webview',
    name: 'Follows a hybrid app into its webview',
    tables: ['readme-mobile', 'mobile'],
    cells: {
      'devtools-service': partial(
        "Follows `switchContext('WEBVIEW_...')`; the object form (`{ title }` / `{ url }`) and `switchAppiumContext` leave capture on the native side.",
        'string form only'
      ),
      'selenium-devtools': partial(STARTUP_CAPS_ONLY),
      'nightwatch-devtools': partial(STARTUP_CAPS_ONLY),
      'selenium-devtools-py': partial(STARTUP_CAPS_ONLY)
    }
  },
  {
    id: 'native-network',
    name: 'Native app network through appium-interceptor (`appium:intercept`)',
    tables: ['readme-mobile', 'mobile'],
    cells: {
      'devtools-service': onAndroid(`${WDIO}intercepted-network.test.ts`),
      'selenium-devtools': onAndroid(`${SELENIUM}native-network.test.ts`),
      'nightwatch-devtools': onAndroid(`${NIGHTWATCH}native-session.test.ts`),
      'selenium-devtools-py': onAndroid(`${PYTHON}test_interceptor_network.py`)
    }
  }
] as const satisfies readonly Feature[]

/** Every feature id, so an option or reference to a misspelt feature fails to compile. */
export type FeatureId = (typeof FEATURES)[number]['id']
