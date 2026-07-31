import { BASELINE_API, TESTS_API } from '@wdio/devtools-shared'
import type { Metadata } from '@wdio/devtools-shared'

import '@components/sidebar/explorer.js'
import type { DevtoolsSidebarExplorer } from '@components/sidebar/explorer.js'
import type { ExplorerTestEntry } from '@components/sidebar/test-suite.js'
import type {
  StatusFilterDetail,
  TestRunDetail,
  TestStatus
} from '@components/sidebar/types.js'
import { metadataContext, suiteContext } from '@/controller/context.js'
import type { SuiteStatsFragment } from '@/controller/types.js'

import { mount, mountWithContext, settle } from '../../support/mount.js'
import type { ContextValue } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  cucumberMetadata,
  FINISHED_AT,
  mixedStateRun,
  mochaMetadata,
  mochaRunnerOptions,
  nestedRun,
  nightwatchMetadata,
  profileSuite,
  SPEC_FILE,
  suiteFragment,
  suiteRegistry,
  testFragment
} from '../fixtures.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'
const ENTRY = 'wdio-test-entry'
const GROUP = 'wdio-test-suite'
const NESTED_GROUP = 'wdio-test-suite[slot="children"]'
const ROOT_ROW = 'wdio-test-entry[root]'
const TEST_ROW = 'wdio-test-entry[entry-type="test"]'
const SELECTED_ROW = 'wdio-test-entry[selected]'
const ROW_LABEL = 'wdio-test-entry > label'
const EMPTY_STATE = 'p.text-disabledForeground'
const RUN_ALL_BUTTON = 'header button[title="Run all"]'
const STOP_ALL_BUTTON = 'header button[title="Stop"]'
const EXPAND_ALL_ICON = 'header icon-mdi-expand-all'
const COLLAPSE_ALL_ICON = 'header icon-mdi-collapse-all'
const LABEL_SPAN = 'section.row > span'
const CHEVRON_BUTTON = 'section.row > button'
const CHILDREN_SLOT = 'slot[name="children"]'
const RUN_BUTTON = 'nav.row-actions button:has(icon-mdi-play)'
const STOP_BUTTON = 'nav.row-actions button:has(icon-mdi-stop)'
const RERUN_BUTTON = 'nav.row-actions button:has(icon-mdi-bug-play)'
const NOT_RUN_ICON = 'icon-mdi-circle-outline'

const CUCUMBER_REASON =
  'Single-test execution is not supported by this framework.'

interface RecordedRequest {
  url: string
  body: Record<string, unknown>
}

const nativeFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = nativeFetch
})

/** The explorer reaches the runner over `fetch`; a component test starts no
 *  backend, so the requests are recorded rather than sent. */
function recordBackend(options: { failing?: boolean } = {}): RecordedRequest[] {
  const requests: RecordedRequest[] = []
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {}
    })
    return Promise.resolve(
      options.failing
        ? new Response('runner unavailable', { status: 500 })
        : new Response('{}', { status: 200 })
    )
  }
  return requests
}

/** Let the awaited fetch inside the explorer's handlers settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function mountExplorer(
  registry: Record<string, SuiteStatsFragment>[],
  metadata?: Metadata
): Promise<DevtoolsSidebarExplorer> {
  const contexts: ContextValue[] = [{ context: suiteContext, value: registry }]
  if (metadata) {
    contexts.push({ context: metadataContext, value: metadata })
  }
  const explorer = await mountWithContext<DevtoolsSidebarExplorer>(
    EXPLORER,
    contexts
  )
  await settle(explorer)
  // The rows render in their own update cycle, so their shadow content is only
  // there once each has settled too.
  for (const row of shadowAll<ExplorerTestEntry>(explorer, ENTRY)) {
    await settle(row)
  }
  return explorer
}

function rowByUid(explorer: Element, uid: string): ExplorerTestEntry {
  const row = shadow<ExplorerTestEntry>(explorer, `${ENTRY}[uid="${uid}"]`)
  if (!row) {
    throw new Error(`no row rendered for uid "${uid}"`)
  }
  return row
}

/** A row renders its group in a second section beside the label row, so the
 *  children slot is the only stable handle on the thing that hides. */
const childrenHidden = (row: Element) =>
  shadow(row, CHILDREN_SLOT)?.parentElement?.classList.contains('hidden')

/** A tree-wide collapse reaches the rows by attribute, so the explorer settling
 *  is not enough — every row it just touched has to re-render too. */
async function settleTree(explorer: DevtoolsSidebarExplorer): Promise<void> {
  await settle(explorer)
  for (const row of shadowAll<ExplorerTestEntry>(explorer, ENTRY)) {
    await settle(row)
  }
  await settle(explorer)
}

const rowLabels = (explorer: Element) => texts(explorer, ROW_LABEL)

const rowStates = (explorer: Element) =>
  shadowAll(explorer, ENTRY).map((row) => row.getAttribute('state'))

const rowUids = (explorer: Element, selector = ENTRY) =>
  shadowAll(explorer, selector).map((row) => row.getAttribute('uid'))

const applyQuery = (filterQuery: string) =>
  window.dispatchEvent(
    new CustomEvent('app-test-filter', { detail: { filterQuery } })
  )

const applyStatus = (status: TestStatus | null) =>
  window.dispatchEvent(
    new CustomEvent<StatusFilterDetail>('app-status-filter', {
      detail: { status }
    })
  )

async function capture<T>(
  target: EventTarget,
  type: string,
  act: () => void
): Promise<CustomEvent<T>[]> {
  const received: CustomEvent<T>[] = []
  const listener = (event: Event) => received.push(event as CustomEvent<T>)
  target.addEventListener(type, listener)
  try {
    act()
    // Reading a fetch Response body is not a microtask, so a handler that
    // awaits `response.text()` before dispatching lands a tick or two after
    // the click — one flush is not enough to see it.
    for (let tick = 0; tick < 10 && received.length === 0; tick += 1) {
      await flush()
    }
  } finally {
    target.removeEventListener(type, listener)
  }
  return received
}

describe('wdio-devtools-sidebar-explorer', () => {
  describe('tree construction', () => {
    it('renders a row for the root suite and one for each of its tests', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(rowLabels(explorer)).toEqual(mixedStateRun.rowLabels)
      expect(shadowAll(explorer, TEST_ROW)).toHaveLength(4)
    })

    it("nests a suite's tests in a group inside its own row", async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(shadowAll(explorer, NESTED_GROUP)).toHaveLength(1)
      expect(rowUids(explorer, `${NESTED_GROUP} > ${ENTRY}`)).toEqual([
        mixedStateRun.passing.uid,
        mixedStateRun.failing.uid,
        mixedStateRun.running.uid,
        mixedStateRun.skipped.uid
      ])
      expect(
        rowByUid(explorer, mixedStateRun.suite.uid).hasAttribute('has-children')
      ).toBe(true)
    })

    it('marks only the outermost suite as a root row', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(rowUids(explorer, ROOT_ROW)).toEqual([mixedStateRun.suite.uid])
    })

    it('carries the reported state of every test onto its row', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(rowStates(explorer)).toEqual([
        'running',
        'passed',
        'failed',
        'running',
        'skipped'
      ])
    })

    it('derives a running suite from a test that is still running', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(
        rowByUid(explorer, mixedStateRun.suite.uid).getAttribute('state')
      ).toBe('running')
    })

    it('derives a failed suite from a failed test once nothing runs', async () => {
      const suite = suiteFragment('report-suite', 'Reporting', {
        tests: [
          testFragment('report-summary', 'writes the summary', {
            state: 'passed',
            end: FINISHED_AT
          }),
          testFragment('report-failures', 'writes the failures', {
            state: 'failed',
            end: FINISHED_AT
          })
        ]
      })
      const explorer = await mountExplorer(suiteRegistry(suite))

      expect(rowByUid(explorer, suite.uid).getAttribute('state')).toBe('failed')
    })

    it('derives a passed suite when none of its tests failed', async () => {
      const explorer = await mountExplorer(suiteRegistry(profileSuite))

      expect(rowByUid(explorer, profileSuite.uid).getAttribute('state')).toBe(
        'passed'
      )
    })

    it('derives a failed feature from a failure inside one of its scenarios', async () => {
      const scenario = suiteFragment('audit-scenario', 'Exports the audit', {
        type: 'scenario',
        parent: 'Auditing',
        tests: [
          testFragment('audit-csv', 'writes a csv', {
            state: 'passed',
            end: FINISHED_AT
          }),
          testFragment('audit-signature', 'signs the export', {
            state: 'failed',
            end: FINISHED_AT
          })
        ]
      })
      const feature = suiteFragment('audit-feature', 'Auditing', {
        suites: [scenario]
      })
      const explorer = await mountExplorer(suiteRegistry(feature, scenario))

      expect(rowByUid(explorer, feature.uid).getAttribute('state')).toBe(
        'failed'
      )
      expect(rowByUid(explorer, scenario.uid).getAttribute('state')).toBe(
        'failed'
      )
    })

    it('derives a running suite from a queued test next to a finished one', async () => {
      // Nightwatch-Cucumber leaves the feature state undefined, so a terminal
      // child alongside a queued one is the only signal the run is in progress.
      const suite = suiteFragment('audit-suite', 'Auditing', {
        tests: [
          testFragment('audit-csv', 'writes a csv', {
            state: 'passed',
            end: FINISHED_AT
          }),
          testFragment('audit-archive', 'archives the export', {
            state: 'pending'
          })
        ]
      })
      const explorer = await mountExplorer(suiteRegistry(suite))

      expect(rowByUid(explorer, suite.uid).getAttribute('state')).toBe(
        'running'
      )
    })

    it('shows a test that finished without a reported state as passed', async () => {
      const finished = testFragment('report-done', 'writes the report', {
        end: FINISHED_AT
      })
      const suite = suiteFragment('report-suite', 'Reporting', {
        tests: [finished]
      })
      const explorer = await mountExplorer(suiteRegistry(suite))

      expect(rowByUid(explorer, finished.uid).getAttribute('state')).toBe(
        'passed'
      )
    })

    it('shows a test that never started as pending with the not-run icon', async () => {
      const never = testFragment('report-archive', 'archives the report')
      const suite = suiteFragment('report-suite', 'Reporting', {
        tests: [never]
      })
      const explorer = await mountExplorer(suiteRegistry(suite))

      const row = rowByUid(explorer, never.uid)
      expect(row.getAttribute('state')).toBe('pending')
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
    })

    it('tags a suite whose children are suites as a feature', async () => {
      const explorer = await mountExplorer(nestedRun.registry)

      expect(
        rowByUid(explorer, nestedRun.feature.uid).getAttribute('suite-type')
      ).toBe('feature')
      expect(
        rowByUid(explorer, nestedRun.scenario.uid).getAttribute('suite-type')
      ).toBe('scenario')
    })

    it('keeps a nested suite out of the root list even though the registry lists it flat', async () => {
      const explorer = await mountExplorer(nestedRun.registry)

      expect(rowUids(explorer, ROOT_ROW)).toEqual([nestedRun.feature.uid])
      expect(rowLabels(explorer)).toEqual(nestedRun.rowLabels)
    })

    it('renders one row for a suite that arrives in more than one registry chunk', async () => {
      const explorer = await mountExplorer([
        ...mixedStateRun.registry,
        ...mixedStateRun.registry
      ])

      expect(rowLabels(explorer)).toEqual(mixedStateRun.rowLabels)
    })

    it('renders nothing at all until the suite registry arrives', async () => {
      const explorer = await mount<DevtoolsSidebarExplorer>(EXPLORER)

      expect(shadowAll(explorer, 'header')).toHaveLength(0)
      expect(shadowAll(explorer, GROUP)).toHaveLength(0)
    })

    it('shows the empty state when the registry holds no suites', async () => {
      const explorer = await mountExplorer([])

      expect(text(shadow(explorer, 'header h3'))).toBe('Tests')
      expect(text(shadow(explorer, EMPTY_STATE))).toBe('No tests to display')
      expect(shadowAll(explorer, ENTRY)).toHaveLength(0)
    })

    it('renders a suite with no tests as a single childless row', async () => {
      const empty = suiteFragment('empty-suite', 'Reporting', { tests: [] })
      const explorer = await mountExplorer(suiteRegistry(empty))

      expect(rowLabels(explorer)).toEqual(['Reporting'])
      expect(shadowAll(explorer, NESTED_GROUP)).toHaveLength(0)
      expect(rowByUid(explorer, empty.uid).hasAttribute('has-children')).toBe(
        false
      )
    })
  })

  describe('filtering', () => {
    it('narrows the tree to the tests matching the filter query', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyQuery('discount')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual([
        mixedStateRun.suite.title,
        mixedStateRun.failing.title
      ])
    })

    it('matches the filter query without regard to case', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyQuery('DISCOUNT')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual([
        mixedStateRun.suite.title,
        mixedStateRun.failing.title
      ])
    })

    it('drops a sibling suite when none of its tests match the query', async () => {
      const explorer = await mountExplorer(
        suiteRegistry(mixedStateRun.suite, profileSuite)
      )
      expect(rowUids(explorer, ROOT_ROW)).toHaveLength(2)

      applyQuery('discount')
      await settle(explorer)

      expect(rowUids(explorer, ROOT_ROW)).toEqual([mixedStateRun.suite.uid])
    })

    it('keeps a suite whose own title matches even when none of its tests do', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyQuery('flow')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual([mixedStateRun.suite.title])
      expect(
        rowByUid(explorer, mixedStateRun.suite.uid).hasAttribute('has-children')
      ).toBe(false)
    })

    it('shows the empty state when the filter query matches nothing', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyQuery('regression')
      await settle(explorer)

      expect(shadowAll(explorer, ENTRY)).toHaveLength(0)
      expect(text(shadow(explorer, EMPTY_STATE))).toBe('No tests to display')
    })

    it('restores the whole tree when the filter query is cleared', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyQuery('discount')
      await settle(explorer)
      applyQuery('')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual(mixedStateRun.rowLabels)
    })

    it('narrows the tree to the tests in a single status', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyStatus('failed')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual([
        mixedStateRun.suite.title,
        mixedStateRun.failing.title
      ])
    })

    it('keeps the running test when the status filter is running', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyStatus('running')
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual([
        mixedStateRun.suite.title,
        mixedStateRun.running.title
      ])
    })

    it('drops a suite with no test in the filtered status', async () => {
      const explorer = await mountExplorer(
        suiteRegistry(mixedStateRun.suite, profileSuite)
      )

      applyStatus('failed')
      await settle(explorer)

      expect(rowUids(explorer, ROOT_ROW)).toEqual([mixedStateRun.suite.uid])
    })

    it('shows the empty state when no test is in the filtered status', async () => {
      const explorer = await mountExplorer(suiteRegistry(profileSuite))

      applyStatus('failed')
      await settle(explorer)

      expect(shadowAll(explorer, ENTRY)).toHaveLength(0)
      expect(text(shadow(explorer, EMPTY_STATE))).toBe('No tests to display')
    })

    it('restores the whole tree when the status filter is cleared', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      applyStatus('failed')
      await settle(explorer)
      applyStatus(null)
      await settle(explorer)

      expect(rowLabels(explorer)).toEqual(mixedStateRun.rowLabels)
    })
  })

  describe('running state', () => {
    it('highlights the deepest running test while nothing has been selected', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(rowUids(explorer, SELECTED_ROW)).toEqual([
        mixedStateRun.running.uid
      ])
    })

    it('renders a stop control on the running row', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      const row = rowByUid(explorer, mixedStateRun.running.uid)
      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
    })

    it('offers a preserve-and-rerun control only on the failed row', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(
        shadowAll(rowByUid(explorer, mixedStateRun.failing.uid), RERUN_BUTTON)
      ).toHaveLength(1)
      expect(
        shadowAll(rowByUid(explorer, mixedStateRun.passing.uid), RERUN_BUTTON)
      ).toHaveLength(0)
    })

    it('moves the highlight to a row that is clicked', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      shadow(rowByUid(explorer, mixedStateRun.passing.uid), LABEL_SPAN)?.click()
      await settle(explorer)

      expect(rowUids(explorer, SELECTED_ROW)).toEqual([
        mixedStateRun.passing.uid
      ])
    })
  })

  describe('header controls', () => {
    it('posts a run request for the whole tree', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      shadow(explorer, RUN_ALL_BUTTON)?.click()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(TESTS_API.run)
      expect(requests[0]?.body).toEqual({
        uid: '*',
        entryType: 'suite',
        runAll: true,
        framework: mochaRunnerOptions.framework,
        configFile: mochaRunnerOptions.configFilePath,
        rerunCommand: mochaRunnerOptions.rerunCommand,
        launchCommand: mochaRunnerOptions.launchCommand
      })
    })

    it('clears the execution data before running the whole tree', async () => {
      recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      const received = await capture<{ uid?: string; entryType?: string }>(
        explorer,
        'clear-execution-data',
        () => shadow(explorer, RUN_ALL_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({ uid: '*', entryType: 'suite' })
    })

    it('posts a stop request for the active run', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      shadow(explorer, STOP_ALL_BUTTON)?.click()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(TESTS_API.stop)
      expect(requests[0]?.body).toEqual({})
    })

    it('disables the run control for a runner that cannot run everything', async () => {
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        nightwatchMetadata
      )

      const run = shadow<HTMLButtonElement>(explorer, RUN_ALL_BUTTON)
      expect(run?.disabled).toBe(true)
      expect(run?.classList.contains('cursor-not-allowed')).toBe(true)
    })

    it('still stops the run for a runner that cannot run everything', async () => {
      // Launching and stopping are separate concerns: /api/tests/stop takes no
      // body and kills whatever the backend spawned, so a Nightwatch run — which
      // has no run-everything entry point — must still be stoppable from here.
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        nightwatchMetadata
      )

      const stop = shadow<HTMLButtonElement>(explorer, STOP_ALL_BUTTON)
      expect(stop?.disabled).toBe(false)
      expect(stop?.classList.contains('cursor-not-allowed')).toBe(false)

      stop?.click()
      await flush()

      expect(requests.map((request) => request.url)).toEqual([TESTS_API.stop])
    })

    it('sends nothing while the run control is disabled', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        nightwatchMetadata
      )

      shadow(explorer, RUN_ALL_BUTTON)?.click()
      await flush()

      expect(requests).toHaveLength(0)
    })

    it('offers to collapse a freshly rendered tree, which shows its children', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)

      expect(childrenHidden(rowByUid(explorer, mixedStateRun.suite.uid))).toBe(
        false
      )
      expect(shadowAll(explorer, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(explorer, EXPAND_ALL_ICON)).toHaveLength(0)
    })

    it('hides every row of children from the header control', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)
      const root = rowByUid(explorer, mixedStateRun.suite.uid)

      shadow(explorer, COLLAPSE_ALL_ICON)?.click()
      await settleTree(explorer)

      expect(childrenHidden(root)).toBe(true)
      expect(shadowAll(explorer, EXPAND_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(explorer, COLLAPSE_ALL_ICON)).toHaveLength(0)
    })

    it('shows every row of children again from the header control', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)
      const root = rowByUid(explorer, mixedStateRun.suite.uid)

      shadow(explorer, COLLAPSE_ALL_ICON)?.click()
      await settleTree(explorer)
      shadow(explorer, EXPAND_ALL_ICON)?.click()
      await settleTree(explorer)

      expect(childrenHidden(root)).toBe(false)
      expect(shadowAll(explorer, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(explorer, EXPAND_ALL_ICON)).toHaveLength(0)
    })

    it('switches the header control back to collapse-all once a row is expanded by hand', async () => {
      const explorer = await mountExplorer(mixedStateRun.registry)
      const root = rowByUid(explorer, mixedStateRun.suite.uid)

      shadow(explorer, COLLAPSE_ALL_ICON)?.click()
      await settleTree(explorer)
      expect(shadowAll(explorer, EXPAND_ALL_ICON)).toHaveLength(1)

      shadow(root, CHEVRON_BUTTON)?.click()
      await settleTree(explorer)

      expect(childrenHidden(root)).toBe(false)
      expect(shadowAll(explorer, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(explorer, EXPAND_ALL_ICON)).toHaveLength(0)
    })
  })

  describe('row controls', () => {
    it('posts a run request for the row that asked to run', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      shadow(rowByUid(explorer, mixedStateRun.failing.uid), RUN_BUTTON)?.click()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(TESTS_API.run)
      expect(requests[0]?.body.uid).toBe(mixedStateRun.failing.uid)
      expect(requests[0]?.body.entryType).toBe('test')
      expect(requests[0]?.body.specFile).toBe(SPEC_FILE)
      expect(requests[0]?.body.runAll).toBe(false)
      expect(requests[0]?.body.framework).toBe(mochaRunnerOptions.framework)
      expect(requests[0]?.body.preserveBaseline).toBe(false)
    })

    // A suite whose tests are still running renders a stop control instead of a
    // run control, so the run path needs a settled suite.
    it('posts a run request for a whole suite row', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        suiteRegistry(profileSuite),
        mochaMetadata
      )

      shadow(rowByUid(explorer, profileSuite.uid), RUN_BUTTON)?.click()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(TESTS_API.run)
      expect(requests[0]?.body.uid).toBe(profileSuite.uid)
      expect(requests[0]?.body.entryType).toBe('suite')
      expect(requests[0]?.body.runAll).toBe(false)
    })

    it('clears the execution data for the row before rerunning it', async () => {
      recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      const received = await capture<{ uid?: string; entryType?: string }>(
        explorer,
        'clear-execution-data',
        () =>
          shadow(
            rowByUid(explorer, mixedStateRun.failing.uid),
            RUN_BUTTON
          )?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({
        uid: mixedStateRun.failing.uid,
        entryType: 'test'
      })
    })

    it('posts a stop request from the running row', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      shadow(
        rowByUid(explorer, mixedStateRun.running.uid),
        STOP_BUTTON
      )?.click()

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(TESTS_API.stop)
      expect(requests[0]?.body).toEqual({})
    })

    it('preserves the current run before rerunning a failed row', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      shadow(
        rowByUid(explorer, mixedStateRun.failing.uid),
        RERUN_BUTTON
      )?.click()
      await flush()

      expect(requests.map((request) => request.url)).toEqual([
        BASELINE_API.preserve,
        TESTS_API.run
      ])
      expect(requests[0]?.body).toEqual({
        testUid: mixedStateRun.failing.uid,
        scope: 'test'
      })
      expect(requests[1]?.body.preserveBaseline).toBe(true)
    })

    it('skips the rerun when preserving the baseline fails', async () => {
      const requests = recordBackend({ failing: true })
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        mochaMetadata
      )

      const logs = await capture<string>(window, 'app-logs', () =>
        shadow(
          rowByUid(explorer, mixedStateRun.failing.uid),
          RERUN_BUTTON
        )?.click()
      )

      expect(requests.map((request) => request.url)).toEqual([
        BASELINE_API.preserve
      ])
      expect(logs[0]?.detail).toBe(
        'Failed to preserve baseline: runner unavailable'
      )
    })
  })

  describe('runner capabilities', () => {
    it('disables the run control on a test row for a runner that cannot run one', async () => {
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        cucumberMetadata
      )

      const button = shadow<HTMLButtonElement>(
        rowByUid(explorer, mixedStateRun.failing.uid),
        RUN_BUTTON
      )
      expect(button?.disabled).toBe(true)
      expect(button?.getAttribute('title')).toBe(CUCUMBER_REASON)
    })

    it('leaves the suite row runnable for a runner that can only run suites', async () => {
      const explorer = await mountExplorer(
        suiteRegistry(profileSuite),
        cucumberMetadata
      )

      const button = shadow<HTMLButtonElement>(
        rowByUid(explorer, profileSuite.uid),
        RUN_BUTTON
      )
      expect(button?.disabled).toBe(false)
      expect(button?.getAttribute('title')).toBe('Run this entry')
    })

    // Cucumber cannot launch a single test, so the run control is withheld —
    // but the step is already running, and stopping is not a launch capability.
    it('keeps a running test row stoppable when single tests cannot be run', async () => {
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        cucumberMetadata
      )

      const row = rowByUid(explorer, mixedStateRun.running.uid)
      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
    })

    it('refuses a run request for a single test and says why', async () => {
      const requests = recordBackend()
      const explorer = await mountExplorer(
        mixedStateRun.registry,
        cucumberMetadata
      )
      const detail: TestRunDetail = {
        uid: mixedStateRun.failing.uid,
        entryType: 'test'
      }

      const logs = await capture<string>(window, 'app-logs', () =>
        explorer.dispatchEvent(
          new CustomEvent<TestRunDetail>('app-test-run', { detail })
        )
      )

      expect(logs.map((log) => log.detail)).toEqual([CUCUMBER_REASON])
      expect(requests).toHaveLength(0)
    })
  })
})
