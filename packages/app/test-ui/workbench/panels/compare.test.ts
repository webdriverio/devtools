import { BASELINE_API } from '@wdio/devtools-shared'
import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'

import {
  baselineContext,
  commandContext,
  selectedTestUidContext,
  suiteContext
} from '@/controller/context.js'
import type { SuiteStatsFragment } from '@/controller/types.js'
import '@components/workbench/compare.js'
import type { DevtoolsCompare } from '@components/workbench/compare.js'
import {
  firstDivergentIndex,
  pairSteps,
  type ComparePairedStep
} from '@components/workbench/compare/compareUtils.js'

import { commandLog } from '../../support/builders.js'
import { mount, mountWithContext, settle } from '../../support/mount.js'
import type { ContextValue } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  RUN_START,
  capturedError,
  suiteFragment,
  suiteRegistry
} from './fixtures.js'
import {
  ASSERT_STEP,
  BASELINE_ERROR_LINES,
  BASELINE_FLASH,
  EXPECTED_FLASH,
  FLASH_ASSERTION_MESSAGE,
  FLASH_SELECTOR,
  LATEST_FLASH,
  LIVE_TEST_TITLE,
  LIVE_TEST_UID,
  RERUN_END,
  RERUN_START,
  SELECTED_UID,
  SUBMIT_SELECTOR,
  baselineMap,
  liveSuitesWith,
  liveTest,
  loginCompare,
  preservedAttempt
} from './compare-fixtures.js'

const PANEL = 'wdio-devtools-compare'
const EMPTY_STATE = '.empty-state'
const EMPTY_LINE = '.empty-state p'
const TOPBAR = '.topbar'
const PILL = '.pill'
const SCOPE = '.scope'
const COL_HEADER = '.col-header'
const DIFFERENCES_ONLY = '.toggle-label input'
const SWAP_BUTTON = 'button[title="Swap sides"]'
const CLEAR_BUTTON = 'button[title="Drop this baseline"]'
const POPOUT_BUTTON = 'button[aria-label="Open in a separate window"]'
const ERROR_BANNER = '.error-banner'
const ERROR_BANNER_TITLE = '.error-banner-title'
const ERROR_BANNER_MESSAGE = '.error-banner-message'
const STEP_ROW = '.step-row'
const STEP_CELL = '.step-cell'
const FIRST_DIVERGENT_CELL = '.step-cell.divergent.first'
const MISSING_CELL = '.step-cell.missing'
const MARKER = '.marker'
const COMMAND_MARKER = '.marker.command'
const DETAIL_PANEL = '.detail-panel'
const DETAIL_BLOCK = '.detail-block'
const DETAIL_HEADING = '.detail-block h4'

/** WebDriver-level failure used by the focused marker fixtures. */
const CLICK_ERROR = 'element click intercepted'

// --- Derived expectations ---------------------------------------------------
// The canonical comparison's pairing is computed with the same `pairSteps` the
// panel calls, over the two command lists the panel is expected to feed it (the
// preserved commands and the *windowed* live ones). A panel that pairs by
// timestamp, drops the fork bit or windows the wrong stream fails these even
// though the literal command lists below still read right.

const LOGIN_PAIRS: ComparePairedStep[] = pairSteps(
  loginCompare.baselineCommands,
  loginCompare.scopedLiveCommands
)

/** Command name per row for one logical side; `''` where that side ran out. */
const pairedCommands = (side: 'baseline' | 'latest') =>
  LOGIN_PAIRS.map((pair) => pair[side]?.command ?? '')

/** The `N.` prefix of every row, 1-based on the pair index. */
const pairNumbers = (pairs: ComparePairedStep[] = LOGIN_PAIRS) =>
  pairs.map((pair) => String(pair.index + 1))

/** The rows the differences-only toggle leaves: divergent or truncated. */
const divergentOrTruncated = LOGIN_PAIRS.filter(
  (pair) => pair.divergent || !pair.baseline || !pair.latest
)

interface CompareInput {
  baselines?: Map<string, PreservedAttempt>
  selectedTestUid?: string
  liveCommands?: CommandLog[]
  liveSuites?: Record<string, SuiteStatsFragment>[]
}

interface RecordedRequest {
  url: string
  method: string
  body: Record<string, unknown>
}

interface OpenedWindow {
  url: string
  name: string
  features: string
}

const nativeFetch = globalThis.fetch
const nativeOpen = window.open
const nativeScrollIntoView = Element.prototype.scrollIntoView

afterEach(() => {
  globalThis.fetch = nativeFetch
  window.open = nativeOpen
  Element.prototype.scrollIntoView = nativeScrollIntoView
})

/** Clearing a baseline is a POST; a component test starts no backend, so the
 *  request is recorded rather than sent. */
function recordBackend(
  options: { rejecting?: boolean } = {}
): RecordedRequest[] {
  const requests: RecordedRequest[] = []
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: String(init?.method),
      body: init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {}
    })
    return options.rejecting
      ? Promise.reject(new Error('backend unreachable'))
      : Promise.resolve(new Response('{}', { status: 200 }))
  }
  return requests
}

function recordWindowOpen(): OpenedWindow[] {
  const opened: OpenedWindow[] = []
  window.open = (url?: string | URL, name?: string, features?: string) => {
    opened.push({
      url: String(url),
      name: String(name),
      features: String(features)
    })
    return null
  }
  return opened
}

function recordScrolls(): Element[] {
  const targets: Element[] = []
  Element.prototype.scrollIntoView = function record(this: Element) {
    targets.push(this)
  }
  return targets
}

/** Let the awaited fetch inside the clear handler settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function mountCompare(input: CompareInput): Promise<DevtoolsCompare> {
  const contexts: ContextValue[] = []
  if (input.baselines) {
    contexts.push({ context: baselineContext, value: input.baselines })
  }
  if (input.selectedTestUid) {
    contexts.push({
      context: selectedTestUidContext,
      value: input.selectedTestUid
    })
  }
  if (input.liveCommands) {
    contexts.push({ context: commandContext, value: input.liveCommands })
  }
  if (input.liveSuites) {
    contexts.push({ context: suiteContext, value: input.liveSuites })
  }
  const panel = await mountWithContext<DevtoolsCompare>(PANEL, contexts)
  await settle(panel)
  return panel
}

/** The canonical scenario: the failing baseline against its passing rerun. */
function mountLogin(overrides: CompareInput = {}): Promise<DevtoolsCompare> {
  return mountCompare({
    baselines: baselineMap(preservedAttempt()),
    selectedTestUid: SELECTED_UID,
    liveCommands: loginCompare.liveCommands,
    liveSuites: loginCompare.liveSuites,
    ...overrides
  })
}

/** Two hand-built runs, compared without a live suite tree — so the latest side
 *  is exactly `latest`, unwindowed. */
function mountPair(
  baseline: CommandLog[],
  latest: CommandLog[],
  steps: PreservedStep[] = []
): Promise<DevtoolsCompare> {
  return mountCompare({
    baselines: baselineMap(
      preservedAttempt({ commands: baseline, steps, test: { state: 'failed' } })
    ),
    selectedTestUid: SELECTED_UID,
    liveCommands: latest
  })
}

const rows = (panel: DevtoolsCompare) => shadowAll(panel, STEP_ROW)

/** The cells of one physical column, one per rendered row. */
const column = (panel: DevtoolsCompare, index: 0 | 1) =>
  rows(panel).map((row) => shadowAll(row, STEP_CELL)[index])

const commandsIn = (panel: DevtoolsCompare, index: 0 | 1) =>
  column(panel, index).map((cell) => text(shadow(cell, 'code')))

const markersIn = (panel: DevtoolsCompare, index: 0 | 1) =>
  column(panel, index).map((cell) => texts(cell, MARKER))

const divergentIn = (panel: DevtoolsCompare, index: 0 | 1) =>
  column(panel, index).map((cell) => cell.classList.contains('divergent'))

/** The `N.` prefix each cell is numbered with — `null` on the dashed side. */
const numbersIn = (panel: DevtoolsCompare, index: 0 | 1) =>
  column(panel, index).map(
    (cell) => (cell.textContent ?? '').trim().match(/^(\d+)\./)?.[1] ?? null
  )

const markerTitle = (cell: Element) =>
  shadow(cell, MARKER)?.getAttribute('title') ?? null

const blocks = (panel: DevtoolsCompare) => shadowAll(panel, DETAIL_BLOCK)

const blockLines = (block: Element) => texts(block, 'pre')

/** Raw lines of an element's text — `text()` collapses the newlines a cleaned
 *  multi-line failure message is made of. */
const lines = (el: Element | null): string[] =>
  (el?.textContent ?? '')
    .trim()
    .split('\n')
    .map((line) => line.trim())

/** Control characters left in rendered text, line breaks excluded: a cleaned
 *  message keeps its line breaks but must carry no escape bytes. */
const controlChars = (el: Element | null): string[] =>
  [...(el?.textContent ?? '')].filter((char) => {
    const code = char.charCodeAt(0)
    return code !== 0x0a && (code < 0x20 || code === 0x7f)
  })

async function clickCell(
  panel: DevtoolsCompare,
  row: number,
  index: 0 | 1
): Promise<void> {
  const cell = column(panel, index)[row]
  if (!cell) {
    throw new Error(`no step cell at row ${row}, column ${index}`)
  }
  cell.click()
  await settle(panel)
}

async function clickAction(
  panel: DevtoolsCompare,
  selector: string
): Promise<void> {
  const button = shadow<HTMLButtonElement>(panel, selector)
  if (!button) {
    throw new Error(`the compare toolbar rendered no ${selector}`)
  }
  button.click()
  await settle(panel)
}

async function showDifferencesOnly(
  panel: DevtoolsCompare,
  on = true
): Promise<void> {
  const toggle = shadow<HTMLInputElement>(panel, DIFFERENCES_ONLY)
  if (!toggle) {
    throw new Error('the compare toolbar rendered no differences-only toggle')
  }
  toggle.checked = on
  toggle.dispatchEvent(new Event('change'))
  await settle(panel)
}

/** Mount with the popout query on the page URL. `#isPopout` is read once, at
 *  construction, so the URL has to carry it before the element exists. The
 *  runner's own params are preserved — it resolves a spec's session from `cid`. */
async function mountInPopoutWindow(): Promise<DevtoolsCompare> {
  const search = window.location.search
  const params = new URLSearchParams(search)
  params.set('view', 'compare')
  history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}`
  )
  try {
    return await mountLogin()
  } finally {
    history.replaceState(null, '', `${window.location.pathname}${search}`)
  }
}

describe('wdio-devtools-compare', () => {
  describe('no baseline', () => {
    it('prompts for a preserve-and-rerun when no baseline was preserved', async () => {
      const panel = await mount<DevtoolsCompare>(PANEL)

      expect(texts(panel, EMPTY_LINE)).toEqual([
        'No baseline preserved.',
        'Click the 📌 Preserve & Rerun button on a failed test to compare the failing run against the rerun.'
      ])
    })

    it('prompts for a preserve-and-rerun while no test is selected', async () => {
      const panel = await mountCompare({
        baselines: baselineMap(preservedAttempt()),
        liveCommands: loginCompare.liveCommands
      })

      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(1)
    })

    it('prompts for a preserve-and-rerun when the baseline belongs to another test', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(preservedAttempt(), 'checkout-suite')
      })

      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(1)
    })

    it('renders no toolbar and no step row while the prompt is showing', async () => {
      const panel = await mount<DevtoolsCompare>(PANEL)

      expect(shadowAll(panel, TOPBAR)).toHaveLength(0)
      expect(shadowAll(panel, COL_HEADER)).toHaveLength(0)
      expect(rows(panel)).toHaveLength(0)
    })
  })

  describe('topbar', () => {
    it('labels each side with its own command count', async () => {
      const panel = await mountLogin()

      expect(texts(panel, PILL)).toEqual([
        'Baseline · failed · 6 commands',
        'Latest · 5 commands'
      ])
    })

    it("carries the baseline test's state as a class on its pill", async () => {
      const panel = await mountLogin()

      expect([...shadowAll(panel, PILL)[0].classList]).toEqual([
        'pill',
        'failed'
      ])
    })

    it('reports an unknown state for a baseline preserved without one', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(preservedAttempt({ test: {} }))
      })

      expect(text(shadow(panel, PILL))).toBe('Baseline · unknown · 6 commands')
      expect([...shadowAll(panel, PILL)[0].classList]).toEqual(['pill'])
    })

    it('names the scope the baseline was preserved at', async () => {
      const panel = await mountLogin()

      expect(text(shadow(panel, SCOPE))).toBe('suite scope')
    })

    it('names the test scope of a baseline preserved from a single test', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(preservedAttempt({ scope: 'test' }))
      })

      expect(text(shadow(panel, SCOPE))).toBe('test scope')
    })

    it('heads the left column with the baseline before a swap', async () => {
      const panel = await mountLogin()

      expect(texts(panel, COL_HEADER)).toEqual(['Baseline', 'Latest'])
    })
  })

  describe('error banner', () => {
    it("renders the baseline failure's message with its colour codes and blank-line runs cleaned", async () => {
      const panel = await mountLogin()

      expect(text(shadow(panel, ERROR_BANNER_TITLE))).toBe(
        'Why the baseline failed'
      )
      expect(lines(shadow(panel, ERROR_BANNER_MESSAGE))).toEqual(
        BASELINE_ERROR_LINES
      )
    })

    it('leaves no invisible control character in the rendered banner', async () => {
      const panel = await mountLogin()
      const banner = shadow(panel, ERROR_BANNER_MESSAGE)

      expect(text(banner)).toContain(`Expected: "${EXPECTED_FLASH}"`)
      expect(controlChars(banner)).toEqual([])
      expect(text(banner)).not.toMatch(/\[\d+m/)
    })

    it('renders no banner for a baseline that carried no error', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(preservedAttempt({ test: { state: 'failed' } }))
      })

      expect(shadowAll(panel, ERROR_BANNER)).toHaveLength(0)
      expect(rows(panel)).toHaveLength(6)
    })
  })

  describe('step pairing', () => {
    it('renders one row per index of the longer run', async () => {
      const panel = await mountLogin()

      expect(rows(panel)).toHaveLength(LOGIN_PAIRS.length)
      expect(rows(panel)).toHaveLength(6)
    })

    it('pairs the two runs by index', async () => {
      const panel = await mountLogin()

      expect(commandsIn(panel, 0)).toEqual(pairedCommands('baseline'))
      expect(commandsIn(panel, 1)).toEqual(pairedCommands('latest'))
      expect(commandsIn(panel, 0)).toEqual([
        'url',
        'setValue',
        'setValue',
        'click',
        'getText',
        'getTitle'
      ])
      expect(commandsIn(panel, 1)).toEqual([
        'url',
        'setValue',
        'setValue',
        'click',
        'getText',
        ''
      ])
    })

    it('numbers every row by its index in the run', async () => {
      const panel = await mountLogin()

      expect(numbersIn(panel, 0)).toEqual(pairNumbers())
      expect(numbersIn(panel, 0)).toEqual(['1', '2', '3', '4', '5', '6'])
    })

    it('dashes the side that ran out of commands', async () => {
      const panel = await mountLogin()

      expect(shadowAll(panel, MISSING_CELL)).toHaveLength(1)
      expect(text(column(panel, 1)[5])).toBe('—')
    })

    it('marks the step where the two runs first differ', async () => {
      const panel = await mountLogin()

      const forkIndex = firstDivergentIndex(LOGIN_PAIRS)
      const first = shadowAll(panel, FIRST_DIVERGENT_CELL)
      expect(first).toHaveLength(2)
      expect(first.map((cell) => text(shadow(cell, 'code')))).toEqual([
        pairedCommands('baseline')[forkIndex],
        pairedCommands('latest')[forkIndex]
      ])
      expect(numbersIn(panel, 0)[forkIndex]).toBe(String(forkIndex + 1))
      expect(first.map((cell) => text(shadow(cell, 'code')))).toEqual([
        'setValue',
        'setValue'
      ])
      expect(numbersIn(panel, 0)[2]).toBe('3')
    })

    it('highlights only the cells that carry a difference, not every row after the fork', async () => {
      const panel = await mountLogin()

      // Rows 4-6 inherit the fork bit but agree command-for-command; only the
      // baseline's failure site (row 5) is flagged on its own account.
      expect(divergentIn(panel, 0)).toEqual([
        false,
        false,
        true,
        false,
        true,
        false
      ])
      expect(divergentIn(panel, 1)).toEqual([
        false,
        false,
        true,
        false,
        false,
        false
      ])
    })

    it('flags no cell as divergent when the two runs ran the same commands', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(
          preservedAttempt({
            commands: loginCompare.identicalCommands,
            steps: [],
            test: { state: 'passed' }
          })
        )
      })

      expect(rows(panel)).toHaveLength(5)
      expect(divergentIn(panel, 0)).toEqual([false, false, false, false, false])
      expect(shadowAll(panel, FIRST_DIVERGENT_CELL)).toHaveLength(0)
    })

    it('renders a single row for a baseline of one command', async () => {
      const panel = await mountPair(
        [commandLog({ command: 'getTitle', args: [] })],
        [commandLog({ command: 'getTitle', args: [] })]
      )

      expect(rows(panel)).toHaveLength(1)
      expect(numbersIn(panel, 0)).toEqual(['1'])
    })
  })

  describe('markers', () => {
    it('marks every side of the canonical comparison with its own status', async () => {
      const panel = await mountLogin()

      expect(markersIn(panel, 0)).toEqual([
        ['✓'],
        ['✓'],
        ['args differ'],
        ['✓'],
        ['✗ in failed step'],
        ['only here', '✓']
      ])
      expect(markersIn(panel, 1)).toEqual([
        ['✓'],
        ['✓'],
        ['args differ'],
        ['✓'],
        ['✓'],
        []
      ])
    })

    it('labels both sides of a step whose arguments differ', async () => {
      const panel = await mountLogin()

      expect(texts(panel, COMMAND_MARKER)).toEqual([
        'args differ',
        'args differ'
      ])
      expect(shadow(column(panel, 0)[2], MARKER)?.getAttribute('title')).toBe(
        'Same command, different arguments (compare args in the expanded view)'
      )
    })

    it('labels both sides of a step that ran a different command', async () => {
      const panel = await mountPair(
        [commandLog({ command: 'getText', args: [FLASH_SELECTOR] })],
        [commandLog({ command: 'getTitle', args: [] })]
      )

      expect(texts(panel, COMMAND_MARKER)).toEqual([
        'different command',
        'different command'
      ])
      expect(divergentIn(panel, 0)).toEqual([true])
      expect(divergentIn(panel, 1)).toEqual([true])
    })

    it('marks only the side that errored when the two runs disagree on the error', async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'click',
            args: [SUBMIT_SELECTOR],
            error: capturedError(CLICK_ERROR)
          })
        ],
        [commandLog({ command: 'click', args: [SUBMIT_SELECTOR] })]
      )

      expect(markersIn(panel, 0)).toEqual([['⚠ error']])
      expect(markersIn(panel, 1)).toEqual([['✓']])
      expect(divergentIn(panel, 0)).toEqual([true])
      expect(divergentIn(panel, 1)).toEqual([false])
      expect(markerTitle(column(panel, 0)[0])).toBe(
        `WebDriver error: ${CLICK_ERROR}`
      )
    })

    it("marks the last command of a failed step as the step's failure site", async () => {
      const panel = await mountLogin()

      expect(markerTitle(column(panel, 0)[4])).toBe(
        `Failed step: ${ASSERT_STEP.fullTitle}\n${FLASH_ASSERTION_MESSAGE}`
      )
    })

    it('ticks an earlier command of the same failed step as identical', async () => {
      const panel = await mountLogin()

      expect(markersIn(panel, 0)[3]).toEqual(['✓'])
      expect(markerTitle(column(panel, 0)[3])).toBe('Identical')
    })

    it("flags a failed step's erroring command and its last command, not the ones between", async () => {
      const failedStep: PreservedStep = {
        uid: 'submit-step',
        title: 'submits the form',
        start: RUN_START,
        end: RUN_START + 2000,
        state: 'failed'
      }
      const commands = [
        commandLog({
          command: 'click',
          args: [SUBMIT_SELECTOR],
          error: capturedError(CLICK_ERROR),
          timestamp: RUN_START + 100
        }),
        commandLog({ command: 'getUrl', args: [], timestamp: RUN_START + 900 }),
        commandLog({
          command: 'getText',
          args: [FLASH_SELECTOR],
          timestamp: RUN_START + 1500
        })
      ]
      const panel = await mountPair(commands, commands, [failedStep])

      expect(markersIn(panel, 0)).toEqual([
        ['✗ in failed step'],
        ['✓'],
        ['✗ in failed step']
      ])
      // The two runs agree, so nothing is highlighted as divergent — the
      // failure-site marker is independent of the diff.
      expect(divergentIn(panel, 0)).toEqual([false, false, false])
    })

    it('marks a single failure site when two commands share a millisecond', async () => {
      const failedStep: PreservedStep = {
        uid: 'assert-step',
        title: 'shows the secure-area flash',
        start: RUN_START,
        end: RUN_START + 2000,
        state: 'failed'
      }
      // Commands are stamped in wall-clock ms, so two fast reads inside one
      // step share a timestamp; only the later one is the failure site.
      const commands = [
        commandLog({
          command: 'getText',
          args: [FLASH_SELECTOR],
          timestamp: RUN_START + 1500
        }),
        commandLog({
          command: 'getAttribute',
          args: [FLASH_SELECTOR, 'class'],
          timestamp: RUN_START + 1500
        })
      ]
      const panel = await mountPair(commands, commands, [failedStep])

      expect(markersIn(panel, 0)).toEqual([['✓'], ['✗ in failed step']])
    })

    it('marks a command that errored as failed when no step state resolved', async () => {
      const errored = commandLog({
        command: 'click',
        args: [SUBMIT_SELECTOR],
        error: capturedError(CLICK_ERROR)
      })
      const panel = await mountPair([errored], [errored])

      expect(markersIn(panel, 0)).toEqual([['✗ failed']])
      expect(markerTitle(column(panel, 0)[0])).toBe(`Failed: ${CLICK_ERROR}`)
    })

    it("titles a passing step's tick with the step the command ran in", async () => {
      const panel = await mountLogin()

      expect(markerTitle(column(panel, 0)[0])).toBe(
        'Step passed: login page fills the login form'
      )
      expect(markerTitle(column(panel, 1)[0])).toBe(
        `Step passed: ${LIVE_TEST_TITLE}`
      )
    })

    it('tags the populated side of a truncated row as only here', async () => {
      const panel = await mountLogin()

      expect(markerTitle(column(panel, 0)[5])).toBe(
        'Only present on this side — the other run ended before this step'
      )
    })

    it('suppresses the only-here tag when the rerun produced no commands at all', async () => {
      const panel = await mountLogin({ liveCommands: [] })

      expect(text(shadow(panel, PILL))).toBe('Baseline · failed · 6 commands')
      expect(texts(panel, PILL)[1]).toBe('Latest · 0 commands')
      expect(markersIn(panel, 0)).toEqual([
        ['✓'],
        ['✓'],
        ['✓'],
        ['✓'],
        ['✗ in failed step'],
        ['✓']
      ])
    })

    it('flags no cell as divergent while the rerun has produced no commands', async () => {
      const panel = await mountLogin({ liveCommands: [] })

      expect(shadowAll(panel, MISSING_CELL)).toHaveLength(6)
      expect(divergentIn(panel, 0)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false
      ])
    })
  })

  describe('latest scoping', () => {
    it("windows the live stream to the selected suite's live tests", async () => {
      const panel = await mountLogin()

      expect(texts(panel, PILL)[1]).toBe('Latest · 5 commands')
      expect(commandsIn(panel, 1)[0]).toBe('url')
    })

    it('spans the window from the first live test to the last', async () => {
      const panel = await mountLogin({
        liveSuites: liveSuitesWith(
          liveTest(
            { start: RERUN_START, end: RERUN_START + 1200 },
            { uid: 'first-half' }
          ),
          liveTest(
            { start: RERUN_START + 1500, end: RERUN_END },
            { uid: 'second-half' }
          )
        )
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 5 commands')
    })

    it('drops the live commands that ran before the selected suite started', async () => {
      const panel = await mountLogin({
        liveSuites: liveSuitesWith(
          liveTest({ start: RERUN_START + 1500, end: RERUN_END })
        )
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 2 commands')
      // Pairing is by index, so the surviving commands line up against the
      // baseline's first two rather than their own.
      expect(commandsIn(panel, 1)).toEqual(['click', 'getText', '', '', '', ''])
    })

    it('walks nested suites to find the selected suite', async () => {
      const panel = await mountLogin({
        liveSuites: loginCompare.nestedLiveSuites
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 5 commands')
    })

    // Preserving from a test row records the TEST's uid, which is the common
    // case; it must window to that test, not fall open to the whole run.
    it('windows the live stream to the selected test when the uid names a test', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(preservedAttempt(), LIVE_TEST_UID),
        selectedTestUid: LIVE_TEST_UID
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 5 commands')
      expect(commandsIn(panel, 1)[0]).toBe('url')
    })

    it('compares the whole live stream when the selected uid is not in the live tree', async () => {
      const panel = await mountLogin({
        liveSuites: suiteRegistry(suiteFragment('checkout-suite'))
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 7 commands')
    })

    it('compares the whole live stream when no live test recorded a start time', async () => {
      const panel = await mountLogin({
        liveSuites: liveSuitesWith(liveTest({ end: RERUN_END }))
      })

      expect(texts(panel, PILL)[1]).toBe('Latest · 7 commands')
    })

    it('leaves the window open-ended for a live test that has not finished', async () => {
      const panel = await mountLogin({
        liveSuites: liveSuitesWith(liveTest({ start: RERUN_START }))
      })

      // Everything from the rerun's first command onwards, so the command of the
      // test that followed is included too.
      expect(texts(panel, PILL)[1]).toBe('Latest · 6 commands')
    })

    it('resolves no live step for a test that has not finished', async () => {
      const panel = await mountLogin({
        liveSuites: liveSuitesWith(liveTest({ start: RERUN_START }))
      })

      expect(markerTitle(column(panel, 1)[0])).toBe('Identical')
    })
  })

  describe('differences only', () => {
    it('hides the rows where the two runs agree', async () => {
      const panel = await mountLogin()
      await showDifferencesOnly(panel)

      // Every row the fork bit or a truncation keeps, and only those — the fork
      // bit sticks, so rows 4-6 stay even though they agree command-for-command.
      expect(commandsIn(panel, 0)).toEqual(
        divergentOrTruncated.map((pair) => pair.baseline?.command ?? '')
      )
      expect(commandsIn(panel, 0)).toEqual([
        'setValue',
        'click',
        'getText',
        'getTitle'
      ])
    })

    it('keeps the original step numbers on the rows it leaves', async () => {
      const panel = await mountLogin()
      await showDifferencesOnly(panel)

      expect(numbersIn(panel, 0)).toEqual(pairNumbers(divergentOrTruncated))
      expect(numbersIn(panel, 0)).toEqual(['3', '4', '5', '6'])
    })

    it('keeps the row where the two runs first differ marked as the first', async () => {
      const panel = await mountLogin()
      await showDifferencesOnly(panel)

      expect(shadowAll(panel, FIRST_DIVERGENT_CELL)).toHaveLength(2)
    })

    it('keeps a truncated row visible', async () => {
      const panel = await mountLogin()
      await showDifferencesOnly(panel)

      expect(shadowAll(panel, MISSING_CELL)).toHaveLength(1)
    })

    it('restores the hidden rows when unchecked', async () => {
      const panel = await mountLogin()
      await showDifferencesOnly(panel)
      await showDifferencesOnly(panel, false)

      expect(rows(panel)).toHaveLength(6)
    })

    it('hides every row of a comparison with no differences', async () => {
      const panel = await mountLogin({
        baselines: baselineMap(
          preservedAttempt({
            commands: loginCompare.identicalCommands,
            steps: [],
            test: { state: 'passed' }
          })
        )
      })
      await showDifferencesOnly(panel)

      expect(rows(panel)).toHaveLength(0)
    })
  })

  describe('swap', () => {
    it('swaps the column headers', async () => {
      const panel = await mountLogin()
      await clickAction(panel, SWAP_BUTTON)

      expect(texts(panel, COL_HEADER)).toEqual(['Latest', 'Baseline'])
    })

    it('swaps the two runs between the columns', async () => {
      const panel = await mountLogin()
      await clickAction(panel, SWAP_BUTTON)

      expect(commandsIn(panel, 0)).toEqual([
        'url',
        'setValue',
        'setValue',
        'click',
        'getText',
        ''
      ])
      expect(commandsIn(panel, 1)[5]).toBe('getTitle')
    })

    it('keeps the failure-site highlight on the baseline after a swap', async () => {
      const panel = await mountLogin()
      await clickAction(panel, SWAP_BUTTON)

      expect(divergentIn(panel, 1)).toEqual([
        false,
        false,
        true,
        false,
        true,
        false
      ])
      expect(markersIn(panel, 1)[4]).toEqual(['✗ in failed step'])
    })

    it('swaps the detail-block labels', async () => {
      const panel = await mountLogin()
      await clickAction(panel, SWAP_BUTTON)
      await clickCell(panel, 4, 0)

      expect(texts(panel, DETAIL_HEADING)).toEqual([
        'Latest · getText',
        'Baseline · getText'
      ])
    })
  })

  describe('detail block', () => {
    it('renders no detail panel until a step is clicked', async () => {
      const panel = await mountLogin()

      expect(shadowAll(panel, DETAIL_PANEL)).toHaveLength(0)
    })

    it('expands the clicked step into one block per side', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 4, 0)

      expect(shadowAll(panel, DETAIL_PANEL)).toHaveLength(1)
      expect(texts(panel, DETAIL_HEADING)).toEqual([
        'Baseline · getText',
        'Latest · getText'
      ])
    })

    it('collapses the panel when the same step is clicked again', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 4, 0)
      await clickCell(panel, 4, 1)

      expect(shadowAll(panel, DETAIL_PANEL)).toHaveLength(0)
    })

    it('moves the panel to another step when that step is clicked', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 4, 0)
      await clickCell(panel, 0, 0)

      expect(shadowAll(panel, DETAIL_PANEL)).toHaveLength(1)
      expect(texts(panel, DETAIL_HEADING)).toEqual([
        'Baseline · url',
        'Latest · url'
      ])
    })

    it('expands from the dashed side of a truncated row', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 5, 1)

      expect(texts(panel, DETAIL_HEADING)).toEqual([
        'Baseline · getTitle',
        'Latest'
      ])
      expect(text(shadow(blocks(panel)[1], 'em'))).toBe(
        'No command at this step'
      )
    })

    it('names the step each command ran in', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])[0]).toBe(
        'step: login page fills the login form'
      )
      expect(blockLines(blocks(panel)[1])[0]).toBe(`step: ${LIVE_TEST_TITLE}`)
    })

    it("renders the failed step's expected and actual values on its failure site", async () => {
      const panel = await mountLogin()
      await clickCell(panel, 4, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        `step: ${ASSERT_STEP.fullTitle}`,
        `args: ["${FLASH_SELECTOR}"]`,
        `result: "${BASELINE_FLASH}"`,
        `expected: "${EXPECTED_FLASH}"`,
        `actual: "${BASELINE_FLASH}"`,
        `assertion: ${FLASH_ASSERTION_MESSAGE}`
      ])
    })

    it('renders no expected or actual for a side whose step passed', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 4, 0)

      expect(blockLines(blocks(panel)[1])).toEqual([
        `step: ${LIVE_TEST_TITLE}`,
        `args: ["${FLASH_SELECTOR}"]`,
        `result: "${LATEST_FLASH}"`
      ])
    })

    it('renders no expected or actual on a command that is not the failure site', async () => {
      const panel = await mountLogin()
      await clickCell(panel, 3, 0)

      expect(
        blockLines(blocks(panel)[0]).some((line) => line.startsWith('expected'))
      ).toBe(false)
    })

    it("renders a command's error in place of its result", async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'click',
            args: [SUBMIT_SELECTOR],
            error: capturedError(CLICK_ERROR)
          })
        ],
        [commandLog({ command: 'click', args: [SUBMIT_SELECTOR] })]
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        `args: ["${SUBMIT_SELECTOR}"]`,
        `error: ${CLICK_ERROR}`
      ])
    })

    it('renders the collapsed values of an assertion command instead of its error', async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'assert.strictEqual',
            args: [BASELINE_FLASH, EXPECTED_FLASH],
            result: {
              passed: false,
              actual: BASELINE_FLASH,
              expected: EXPECTED_FLASH
            },
            error: capturedError('AssertionError: strictEqual failed')
          })
        ],
        []
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        `args: ["${BASELINE_FLASH}","${EXPECTED_FLASH}"]`,
        `expected: "${EXPECTED_FLASH}"`,
        `actual: "${BASELINE_FLASH}"`
      ])
    })

    it('reads the positional args of an assertion command that carries no collapsed result', async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'verify.equal',
            args: [BASELINE_FLASH, EXPECTED_FLASH],
            error: capturedError('verify.equal failed')
          })
        ],
        []
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        `args: ["${BASELINE_FLASH}","${EXPECTED_FLASH}"]`,
        `expected: "${EXPECTED_FLASH}"`,
        `actual: "${BASELINE_FLASH}"`
      ])
    })

    it('falls back to the error of an assertion command with a single argument', async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'assert.ok',
            args: [false],
            error: capturedError('assert.ok failed')
          })
        ],
        []
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        'args: [false]',
        'error: assert.ok failed'
      ])
    })

    it('derives the expected value from the step text when the assertion surfaced none', async () => {
      const cucumberStep: PreservedStep = {
        uid: 'flash-step',
        title: 'Then I should see a flash message saying "Secure Area"',
        start: RUN_START,
        end: RUN_START + 1000,
        state: 'failed'
      }
      const panel = await mountPair(
        [
          commandLog({
            command: 'getText',
            args: [FLASH_SELECTOR],
            result: BASELINE_FLASH,
            timestamp: RUN_START
          })
        ],
        [],
        [cucumberStep]
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])).toEqual([
        `step: ${cucumberStep.title}`,
        `args: ["${FLASH_SELECTOR}"]`,
        `result: "${BASELINE_FLASH}"`,
        `expected (from step): "${EXPECTED_FLASH}"`
      ])
      expect(
        shadowAll(blocks(panel)[0], 'pre')[3].getAttribute('title')
      ).toContain('Derived from the step text')
    })

    it('renders no step banner for a baseline preserved without steps', async () => {
      const panel = await mountPair(
        [commandLog({ command: 'getTitle', args: [] })],
        []
      )
      await clickCell(panel, 0, 0)

      expect(blockLines(blocks(panel)[0])[0]).toBe('args: []')
    })

    it('renders a captured screenshot as an inline image', async () => {
      const panel = await mountPair(
        [
          commandLog({
            command: 'getTitle',
            args: [],
            screenshot: 'iVBORw0KGg'
          })
        ],
        []
      )
      await clickCell(panel, 0, 0)

      expect(shadow(blocks(panel)[0], 'img')?.getAttribute('src')).toBe(
        'data:image/png;base64,iVBORw0KGg'
      )
    })

    it('leaves an already-encoded screenshot data URL alone', async () => {
      const screenshot = 'data:image/png;base64,iVBORw0KGg'
      const panel = await mountPair(
        [commandLog({ command: 'getTitle', args: [], screenshot })],
        []
      )
      await clickCell(panel, 0, 0)

      expect(shadow(blocks(panel)[0], 'img')?.getAttribute('src')).toBe(
        screenshot
      )
    })
  })

  describe('clear', () => {
    it('posts the selected test uid to the baseline clear endpoint', async () => {
      const panel = await mountLogin()
      const requests = recordBackend()

      await clickAction(panel, CLEAR_BUTTON)
      await flush()

      expect(requests).toEqual([
        {
          url: BASELINE_API.clear,
          method: 'POST',
          body: { testUid: SELECTED_UID }
        }
      ])
    })

    it('keeps rendering the comparison when the clear request fails', async () => {
      const panel = await mountLogin()
      const requests = recordBackend({ rejecting: true })

      await clickAction(panel, CLEAR_BUTTON)
      await flush()

      // The server broadcast is what drops the baseline; the panel does not
      // clear itself optimistically.
      expect(requests).toHaveLength(1)
      expect(rows(panel)).toHaveLength(6)
    })
  })

  describe('pop out', () => {
    it('opens the comparison in a window named after the selected test', async () => {
      const panel = await mountLogin()
      const opened = recordWindowOpen()

      await clickAction(panel, POPOUT_BUTTON)

      expect(opened).toEqual([
        {
          url: `${window.location.pathname}?view=compare&uid=${SELECTED_UID}`,
          name: `compare-${SELECTED_UID}`,
          features: 'width=1400,height=900,resizable=yes,scrollbars=yes'
        }
      ])
    })

    it('renders no pop-out button inside a popout window', async () => {
      const panel = await mountInPopoutWindow()

      expect(shadowAll(panel, POPOUT_BUTTON)).toHaveLength(0)
      expect(shadowAll(panel, SWAP_BUTTON)).toHaveLength(1)
      expect(shadowAll(panel, CLEAR_BUTTON)).toHaveLength(1)
    })
  })

  describe('autoscroll', () => {
    it('scrolls the step where the runs first differ into view', async () => {
      const scrolled = recordScrolls()
      await mountLogin()

      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].getAttribute('data-first-divergent')).toBe('true')
      expect(text(shadow(scrolled[0], 'code'))).toBe('setValue')
    })

    it('scrolls only once for the selected test', async () => {
      const scrolled = recordScrolls()
      const panel = await mountLogin()
      await clickAction(panel, SWAP_BUTTON)

      expect(scrolled).toHaveLength(1)
    })

    it('does not scroll when the two runs agree', async () => {
      const scrolled = recordScrolls()
      await mountLogin({
        baselines: baselineMap(
          preservedAttempt({
            commands: loginCompare.identicalCommands,
            steps: [],
            test: { state: 'passed' }
          })
        )
      })

      expect(scrolled).toHaveLength(0)
    })
  })
})
