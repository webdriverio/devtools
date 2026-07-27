// The cross-adapter verification matrix. One entry per (adapter, runner)
// example the harness drives through the same login flow. Adding a runner later
// = adding a row here; nothing else in the harness enumerates adapters.
//
// `regen.ts` uses `command` + `traceOutputGlobs` to produce and collect a golden
// fixture; `capture-parity.test.ts` loads the fixture and snapshots its capture
// summary. The two stay in sync through this file.

export type AdapterId = 'wdio' | 'selenium' | 'nightwatch'
export type RunnerId = 'mocha' | 'cucumber' | 'bdd'

export interface VerificationEntry {
  /** Stable slug — also the fixture folder name under `test/fixtures/`. */
  id: string
  adapter: AdapterId
  runner: RunnerId
  label: string
  /** `ready` entries regen + verify; `planned` are documented gaps skipped by
   *  both (kept here so the matrix shows the whole intended surface). */
  status: 'ready' | 'planned'
  /** Why a `planned` entry can't run yet. */
  plannedReason?: string
  /** Command to produce a trace, spawned from the repo root with
   *  `DEVTOOLS_MODE=trace` in the environment. */
  command: { cmd: string; args: string[] }
  /** Directories cleaned before a regen run so "newest zip" is unambiguous. */
  cleanDirs: string[]
  /** Globs (repo-root-relative) the produced `trace.zip` lands under; the
   *  newest match is collected as the fixture. */
  traceOutputGlobs: string[]
}

export const ENTRIES: VerificationEntry[] = [
  {
    id: 'wdio-mocha',
    adapter: 'wdio',
    runner: 'mocha',
    label: 'WebdriverIO · mocha',
    status: 'ready',
    command: {
      cmd: 'npx',
      args: ['wdio', 'run', './examples/wdio/mocha/wdio.trace.conf.ts']
    },
    cleanDirs: ['examples/wdio/mocha/test-results'],
    traceOutputGlobs: ['examples/wdio/mocha/test-results/**/trace*.zip']
  },
  {
    id: 'wdio-cucumber',
    adapter: 'wdio',
    runner: 'cucumber',
    label: 'WebdriverIO · cucumber',
    status: 'ready',
    command: {
      cmd: 'npx',
      args: ['wdio', 'run', './examples/wdio/cucumber/wdio.trace.conf.ts']
    },
    cleanDirs: ['examples/wdio/cucumber/test-results'],
    traceOutputGlobs: ['examples/wdio/cucumber/test-results/**/trace*.zip']
  },
  {
    id: 'selenium-mocha',
    adapter: 'selenium',
    runner: 'mocha',
    label: 'Selenium · mocha',
    status: 'ready',
    command: {
      cmd: 'pnpm',
      args: ['--filter', '@wdio/selenium-devtools', 'example:mocha']
    },
    cleanDirs: [
      'examples/selenium/mocha-test/test/test-results',
      'examples/selenium/mocha-test/allure-results'
    ],
    traceOutputGlobs: [
      'examples/selenium/mocha-test/test/test-results/**/trace*.zip'
    ]
  },
  {
    id: 'selenium-cucumber',
    adapter: 'selenium',
    runner: 'cucumber',
    label: 'Selenium · cucumber',
    status: 'ready',
    command: {
      cmd: 'pnpm',
      args: ['--filter', '@wdio/selenium-devtools', 'example:cucumber']
    },
    cleanDirs: [
      'examples/selenium/cucumber-test/features/support/test-results'
    ],
    traceOutputGlobs: [
      'examples/selenium/cucumber-test/features/support/test-results/**/trace*.zip'
    ]
  },
  {
    id: 'nightwatch-bdd',
    adapter: 'nightwatch',
    runner: 'bdd',
    label: 'Nightwatch · BDD (describe/it)',
    status: 'ready',
    command: {
      cmd: 'pnpm',
      args: ['--filter', '@wdio/nightwatch-devtools', 'example']
    },
    cleanDirs: ['examples/nightwatch/tests/test-results'],
    traceOutputGlobs: ['examples/nightwatch/tests/test-results/**/trace*.zip']
  },
  {
    id: 'nightwatch-cucumber',
    adapter: 'nightwatch',
    runner: 'cucumber',
    label: 'Nightwatch · cucumber',
    // Documented limitation: Nightwatch's cucumber runner launches a browser
    // session PER SCENARIO, so the adapter's session-scoped trace export (written
    // once at run-end) has no single live session to finalize and produces no
    // trace.zip. The example runs and captures per-scenario in trace mode; only
    // the session-zip export is missing. See CLAUDE.md known debt. Supporting it
    // needs per-scenario trace writing in @wdio/nightwatch-devtools.
    status: 'planned',
    command: {
      cmd: 'pnpm',
      args: ['--filter', '@wdio/nightwatch-devtools', 'example:cucumber']
    },
    cleanDirs: [
      'examples/nightwatch/cucumber/test-results',
      'examples/nightwatch/cucumber/features/step_definitions/test-results'
    ],
    traceOutputGlobs: [
      'examples/nightwatch/cucumber/**/test-results/**/trace*.zip'
    ]
  }
]

export const READY_ENTRIES = ENTRIES.filter((entry) => entry.status === 'ready')
