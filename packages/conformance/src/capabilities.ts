import { RULES } from './constants.js'
import type { AdapterId, Capability, Cell, RuleId } from './types.js'

// A Record, so a new adapter id fails to compile until it has a column title.
const ADAPTER_TITLES: Record<AdapterId, string> = {
  'devtools-service': 'WebdriverIO',
  'selenium-devtools': 'Selenium',
  'nightwatch-devtools': 'Nightwatch',
  'selenium-devtools-py': 'Python'
}

/** Column order of every rendered table. */
export const ADAPTER_COLUMNS = (
  Object.entries(ADAPTER_TITLES) as [AdapterId, string][]
).map(([id, title]) => ({ id, title }))

const SUPPORTED: Cell = { support: 'supported' }
const proven = (rules: RuleId[]): Cell => ({ support: 'proven', rules })
const partial = (reason: string, label?: string): Cell => ({
  support: 'partial',
  reason,
  label
})
const unsupported = (reason: string, label?: string): Cell => ({
  support: 'unsupported',
  reason,
  label
})

const DOM_RULES: RuleId[] = [
  RULES.documentAnchored,
  RULES.anchorOnce,
  RULES.anchorBirthTime,
  RULES.rowReplaysPage
]
const ACTION_RULES: RuleId[] = [
  RULES.rowPerAction,
  RULES.completionStamp,
  RULES.navigationNamesDestination,
  RULES.replaceTargetsRow
]
const NETWORK_RULES: RuleId[] = [
  RULES.requestListed,
  RULES.requestListedOnce,
  RULES.requestSourceServed
]
const ERROR_RULES: RuleId[] = [
  RULES.failureRecorded,
  RULES.errorCarriesBrowserMessage
]

const ALL_SUPPORTED: Record<AdapterId, Cell> = {
  'devtools-service': SUPPORTED,
  'selenium-devtools': SUPPORTED,
  'nightwatch-devtools': SUPPORTED,
  'selenium-devtools-py': SUPPORTED
}

const allProven = (rules: RuleId[]): Record<AdapterId, Cell> => ({
  'devtools-service': proven(rules),
  'selenium-devtools': proven(rules),
  'nightwatch-devtools': proven(rules),
  'selenium-devtools-py': proven(rules)
})

/** Rules that test something other than one adapter's capability, so no cell is proven by them. */
export const INTERNAL_RULES: Partial<Record<RuleId, string>> = {
  [RULES.agreeOnRequests]:
    'Compares the adapters with one another; each adapter is judged by every-browser-request-listed.',
  [RULES.agreeOnActions]:
    'Compares the adapters with one another; each adapter is judged by one-row-per-browser-action.',
  [RULES.agreeOnErrors]:
    'Compares the adapters with one another; each adapter is judged by failed-command-has-error-row.',
  [RULES.agreeOnPages]:
    'Compares the adapters with one another; each adapter is judged by row-replays-its-page.',
  [RULES.agreeOnSnapshots]:
    'Compares the adapters with one another; each adapter is judged by every-document-anchored.',
  [RULES.agreeOnRunControls]:
    'Compares the adapters with one another; each adapter is judged by run-controls-are-served.'
}

// appium-interceptor is an Android plugin; iOS app traffic needs a device or proxy capture outside the adapters.
const ANDROID_ONLY: Cell = { support: 'supported', label: 'Android' }

const SAFARI_FOCUS_ONCE =
  'Brings Safari to the front once after the session starts (live mode, local macOS), so a click issued after another window took the front can still land nowhere.'
const NO_SCREENSHOT_SWITCH = 'No option: every command row takes a screenshot.'
const NO_HEADLESS_OPTION =
  'No option: set headless in the browser capabilities, as for any run.'

const WITHOUT_BIDI_ANCHOR =
  'Without BiDi (Safari, Appium) the page collector is injected after each navigation, so a page the test leaves within tens of milliseconds is never captured.'
const WITHOUT_BIDI_DRAIN =
  'Without BiDi a page the test leaves within tens of milliseconds is never drained, so its requests are not listed.'
const NETWORK_FLOOR =
  "Fetch and XHR calls carry headers and bodies; every other load comes from the page's Resource Timing buffer, with timing and size but no headers or body, and no status on Safari."
const STARTUP_CAPS_ONLY =
  "Decides from the startup capabilities, so a hybrid app's webview half is captured as if it were still native."

export const CAPABILITIES: Capability[] = [
  {
    id: 'trace-mode',
    name: 'Trace mode + `show-trace` player',
    tables: ['readme-trace', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'dom-time-travel',
    name: 'DOM time-travel (mutation capture)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': proven(DOM_RULES),
      'selenium-devtools': partial(WITHOUT_BIDI_ANCHOR, 'with BiDi'),
      'nightwatch-devtools': partial(WITHOUT_BIDI_ANCHOR, 'with BiDi'),
      'selenium-devtools-py': proven(DOM_RULES)
    }
  },
  {
    id: 'network-requests',
    name: 'Network requests (browser sessions)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': proven(NETWORK_RULES),
      'selenium-devtools': partial(WITHOUT_BIDI_DRAIN, 'with BiDi'),
      'nightwatch-devtools': partial(WITHOUT_BIDI_DRAIN, 'with BiDi'),
      'selenium-devtools-py': proven(NETWORK_RULES)
    }
  },
  {
    id: 'filmstrip',
    name: 'Screencast (`filmstrip` / video)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': { support: 'supported', label: 'CDP push' },
      'selenium-devtools': { support: 'supported', label: 'CDP push' },
      'nightwatch-devtools': partial(
        'Nightwatch exposes no stable CDP handle, so frames come from a `takeScreenshot` poll every 200 ms.',
        'polling only'
      ),
      'selenium-devtools-py': { support: 'supported', label: 'CDP push' }
    }
  },
  {
    id: 'per-test-granularity',
    name: "Per-test granularity (`traceGranularity: 'test'`)",
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': SUPPORTED,
      'nightwatch-devtools': partial(
        "The BDD `describe/it` interface fires the plugin's hooks once per module, so it collapses to one slice keyed to the first test; Cucumber and exports-object get real per-test slices."
      ),
      'selenium-devtools-py': SUPPORTED
    }
  },
  {
    id: 'retry-retention',
    name: 'Retry-aware retention (`tracePolicy`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': SUPPORTED,
      'nightwatch-devtools': partial(
        "Nightwatch's `--retries` reruns a testcase internally without firing the per-test hooks again, so the other policies behave like `retain-on-failure`.",
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
      'devtools-service': SUPPORTED,
      'selenium-devtools': SUPPORTED,
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
      'selenium-devtools': SUPPORTED,
      'nightwatch-devtools': partial(
        'Nightwatch steps are not stamped as nested groups, so the trace nests Feature→Scenario.',
        'Feature→Scenario'
      ),
      'selenium-devtools-py': unsupported(
        'The Python adapter stamps no Feature, Scenario or Step groups, so a pytest-bdd run nests as plain tests.'
      )
    }
  },
  {
    id: 'assertion-capture',
    name: 'Assertion capture (`captureAssertions`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': partial(
        '`node:assert` rows pass and fail; jest-style `expect()` and chai expose no pass hook, so only failing matchers appear there.'
      ),
      'nightwatch-devtools': SUPPORTED,
      'selenium-devtools-py': SUPPORTED
    }
  },
  {
    id: 'auto-bidi',
    name: 'BiDi console / network capture',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': { support: 'supported', label: 'auto' },
      'selenium-devtools': { support: 'supported', label: 'auto' },
      'nightwatch-devtools': partial(
        'Nightwatch turns it on with `bidi: true` plus `webSocketUrl: true` in the capabilities.',
        'opt-in'
      ),
      'selenium-devtools-py': { support: 'supported', label: 'auto' }
    }
  },
  {
    id: 'a11y-overlay',
    name: 'A11y tab + pick-locator overlay (trace player)',
    tables: ['readme-trace', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'transcript',
    name: 'Transcript + Copy-for-LLM (trace player)',
    tables: ['readme-trace', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'actions-list',
    name: 'One row per command in the Actions list',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allProven(ACTION_RULES)
  },
  {
    id: 'command-screenshots',
    name: 'Screenshot on every command row',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'console-logs',
    name: 'Browser console logs',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'source-tab',
    name: 'Source tab opens the test line that ran the command',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'metadata-tab',
    name: 'Metadata tab (session, capabilities, device)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allProven([RULES.metadataFirst])
  },
  {
    id: 'performance-timings',
    name: 'Performance timings on navigation rows',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'failed-command-errors',
    name: "Failed command in the Errors tab, with the browser's message",
    tables: ['readme-dashboard', 'cross-framework'],
    cells: allProven(ERROR_RULES)
  },
  {
    id: 'run-controls',
    name: 'Run, Rerun and Run all from the dashboard',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': proven([RULES.runControlsServed]),
      'selenium-devtools': proven([RULES.runControlsServed]),
      'nightwatch-devtools': partial(
        'The backend reruns a Nightwatch config through its framework path, which selects suites and tests but has no whole-run entry.',
        'no Run all'
      ),
      'selenium-devtools-py': proven([RULES.runControlsServed])
    }
  },
  {
    id: 'preserve-rerun',
    name: 'Preserve & Rerun (compare a failed run with its rerun)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: ALL_SUPPORTED
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
      'selenium-devtools': { support: 'supported', label: '`openUi: false`' },
      'nightwatch-devtools': partial(
        'Nightwatch always opens the dashboard in live mode.',
        'always opens'
      ),
      'selenium-devtools-py': {
        support: 'supported',
        label: '`DEVTOOLS_OPEN=0`'
      }
    }
  },
  {
    id: 'screenshot-switch',
    name: 'Turn off per-command screenshots (`captureScreenshots`)',
    tables: ['readme-dashboard', 'cross-framework'],
    cells: {
      'devtools-service': unsupported(NO_SCREENSHOT_SWITCH),
      'selenium-devtools': SUPPORTED,
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
      'selenium-devtools': { support: 'supported', label: 'before each input' },
      'nightwatch-devtools': partial(SAFARI_FOCUS_ONCE, 'once'),
      'selenium-devtools-py': partial(SAFARI_FOCUS_ONCE, 'once')
    }
  },
  {
    id: 'trace-format',
    name: "Unpacked trace output (`traceFormat: 'ndjson-directory'`)",
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': SUPPORTED,
      'nightwatch-devtools': SUPPORTED,
      'selenium-devtools-py': unsupported(
        'The Python adapter has no option for it; the backend it asks always writes a zip.',
        'zip only'
      )
    }
  },
  {
    id: 'artifacts-manifest',
    name: 'Artifacts manifest for CI and reporters (`emitArtifactsManifest`)',
    tables: ['readme-trace', 'cross-framework'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': SUPPORTED,
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
    tables: ['readme-mobile', 'cross-framework', 'mobile'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'ios',
    name: 'iOS (XCUITest): native apps and Safari',
    tables: ['readme-mobile', 'cross-framework', 'mobile'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'native-detected',
    name: 'Native session detected, page-side capture skipped',
    tables: ['readme-mobile', 'cross-framework', 'mobile'],
    cells: ALL_SUPPORTED
  },
  {
    id: 'hybrid-webview',
    name: 'Follows a hybrid app into its webview',
    tables: ['readme-mobile', 'cross-framework', 'mobile'],
    cells: {
      'devtools-service': SUPPORTED,
      'selenium-devtools': partial(STARTUP_CAPS_ONLY),
      'nightwatch-devtools': partial(STARTUP_CAPS_ONLY),
      'selenium-devtools-py': partial(STARTUP_CAPS_ONLY)
    }
  },
  {
    id: 'native-network',
    name: 'Native app network through appium-interceptor (`appium:intercept`)',
    tables: ['readme-mobile', 'cross-framework', 'mobile'],
    cells: {
      'devtools-service': ANDROID_ONLY,
      'selenium-devtools': ANDROID_ONLY,
      'nightwatch-devtools': ANDROID_ONLY,
      'selenium-devtools-py': ANDROID_ONLY
    }
  }
]
