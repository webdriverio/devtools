import type { ConsoleLog } from '@wdio/devtools-shared'

import { consoleLogContext } from '@/controller/context.js'
import '@components/workbench/console.js'
import type { DevtoolsConsoleLogs } from '@components/workbench/console.js'
import { formatConsoleArgs } from '@components/workbench/console-filter.js'

import { mount, mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  LONG_CONSOLE_MESSAGE,
  RUNNER_WARN_TEXT,
  RUN_START,
  loginConsole,
  consoleLog
} from './fixtures.js'

const PANEL = 'wdio-devtools-console-logs'
const ENTRY = '.log-entry'
const MESSAGE = '.log-message'
const ICON = '.log-icon'
const BADGE = '.log-badge'
const TIME = '.log-time'
const LEVEL_TAB = '.filter-tab'
const ACTIVE_LEVEL_TAB = '.filter-tab.active'
const SEARCH = '.search-input'
const TOOLBAR = '.console-header'
const EMPTY_STATE = '.empty-state'
const FILTER_EMPTY = '.console-container .empty-state-text'

/** The four `loginConsole` messages as the panel renders them — derived through
 *  the same formatter the panel calls, so a row wired to the wrong entry (or to
 *  the raw args) fails. The literals below pin the strings a user reads. */
const MESSAGES = loginConsole.logs.map((log) => formatConsoleArgs(log.args))

const MESSAGE_LITERALS = [
  '[TEST] logging in with valid credentials',
  'navigating to /secure',
  RUNNER_WARN_TEXT,
  "TypeError: Cannot read properties of undefined (reading 'flash')"
]

/** Elapsed time as the panel measures it: seconds since the *first captured*
 *  log, to one decimal. Written out because `#formatElapsedTime` is private. */
const elapsed = (timestamp: number) =>
  `${((timestamp - loginConsole.logs[0].timestamp) / 1000).toFixed(1)}s`

async function mountConsole(logs: ConsoleLog[]): Promise<DevtoolsConsoleLogs> {
  const panel = await mountWithContext<DevtoolsConsoleLogs>(PANEL, [
    { context: consoleLogContext, value: logs }
  ])
  await settle(panel)
  return panel
}

const levelClassOf = (row: Element) =>
  [...row.classList].find((name) => name.startsWith('log-type-'))

const badgeClassOf = (badge: Element) =>
  [...badge.classList].find((name) => name !== 'log-badge')

async function clickLevelTab(panel: DevtoolsConsoleLogs, label: string) {
  const tab = shadowAll(panel, LEVEL_TAB).find(
    (button) => text(button) === label
  )
  if (!tab) {
    throw new Error(`no level filter tab labelled "${label}"`)
  }
  tab.click()
  await settle(panel)
}

async function search(panel: DevtoolsConsoleLogs, query: string) {
  const input = shadow<HTMLInputElement>(panel, SEARCH)
  if (!input) {
    throw new Error('the console toolbar rendered no search input')
  }
  input.value = query
  input.dispatchEvent(new Event('input'))
  await settle(panel)
}

describe('wdio-devtools-console-logs', () => {
  describe('log list', () => {
    it('renders one row per captured log entry', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(shadowAll(panel, ENTRY)).toHaveLength(4)
    })

    it('renders the messages in the order they were captured', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(texts(panel, MESSAGE)).toEqual(MESSAGES)
      expect(texts(panel, MESSAGE)).toEqual(MESSAGE_LITERALS)
    })

    it('keeps capture order rather than sorting rows by timestamp', async () => {
      const panel = await mountConsole([
        consoleLog({ args: ['logged first'], timestamp: RUN_START + 900 }),
        consoleLog({ args: ['logged second'], timestamp: RUN_START + 100 })
      ])

      expect(texts(panel, MESSAGE)).toEqual(['logged first', 'logged second'])
    })

    it('joins string args and pretty-prints object args into one message', async () => {
      const panel = await mountConsole([
        consoleLog({ args: ['secure area', { attempts: 2 }] })
      ])

      expect(text(shadow(panel, MESSAGE))).toBe('secure area { "attempts": 2 }')
    })

    it('renders a long message in full instead of truncating it', async () => {
      const panel = await mountConsole([
        consoleLog({ args: [LONG_CONSOLE_MESSAGE] })
      ])

      expect(text(shadow(panel, MESSAGE))).toBe(LONG_CONSOLE_MESSAGE.trim())
    })
  })

  describe('log level', () => {
    it('tags each row with the level it was logged at', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(shadowAll(panel, ENTRY).map(levelClassOf)).toEqual([
        'log-type-log',
        'log-type-info',
        'log-type-warn',
        'log-type-error'
      ])
    })

    it('renders the icon that belongs to each level', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(texts(panel, ICON)).toEqual(['›', 'ⓘ', '⚠', '✕'])
    })

    it('falls back to the plain log icon for a level with no icon of its own', async () => {
      const panel = await mountConsole([consoleLog({ type: 'debug' })])

      expect(text(shadow(panel, ICON))).toBe('›')
      expect(levelClassOf(shadowAll(panel, ENTRY)[0])).toBe('log-type-debug')
    })
  })

  describe('source badge', () => {
    it('labels browser logs PAGE, spec logs TEST and runner output RUNNER', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(texts(panel, BADGE)).toEqual(['PAGE', 'TEST', 'RUNNER', 'PAGE'])
    })

    it('styles each source badge with its own class', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(shadowAll(panel, BADGE).map(badgeClassOf)).toEqual([
        'b-browser',
        'b-test',
        'b-runner',
        'b-browser'
      ])
    })

    it('renders no badge for an entry captured without a source', async () => {
      const panel = await mountConsole([consoleLog({ source: undefined })])

      expect(shadowAll(panel, BADGE)).toHaveLength(0)
      expect(shadowAll(panel, ENTRY)).toHaveLength(1)
    })
  })

  describe('timestamp', () => {
    it("renders each row's time elapsed from the first captured log", async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(texts(panel, TIME)).toEqual(
        loginConsole.logs.map((log) => elapsed(log.timestamp))
      )
      expect(texts(panel, TIME)).toEqual(['0.0s', '0.4s', '1.2s', '2.5s'])
    })

    it('renders an empty time cell for an entry without a timestamp', async () => {
      const panel = await mountConsole([consoleLog({ timestamp: 0 })])

      expect(text(shadow(panel, TIME))).toBe('')
    })
  })

  describe('filtering', () => {
    it('shows every level with the All tab active before anything is filtered', async () => {
      const panel = await mountConsole(loginConsole.logs)

      expect(text(shadow(panel, ACTIVE_LEVEL_TAB))).toBe('All')
      expect(shadowAll(panel, ENTRY)).toHaveLength(4)
    })

    it('narrows the list to error rows when the Errors tab is clicked', async () => {
      const panel = await mountConsole(loginConsole.logs)
      await clickLevelTab(panel, 'Errors')

      expect(text(shadow(panel, ACTIVE_LEVEL_TAB))).toBe('Errors')
      expect(texts(panel, MESSAGE)).toEqual([MESSAGES[3]])
    })

    it('keeps elapsed time measured from the first captured log while filtered', async () => {
      const panel = await mountConsole(loginConsole.logs)
      await clickLevelTab(panel, 'Errors')

      // Measured from the first *captured* log, not the first *visible* one —
      // re-basing on the filtered list would read 0.0s here.
      expect(texts(panel, TIME)).toEqual([
        elapsed(loginConsole.pageError.timestamp)
      ])
      expect(texts(panel, TIME)).toEqual(['2.5s'])
    })

    it('shows only log-level rows under the Logs tab, dropping a debug entry', async () => {
      const panel = await mountConsole([
        consoleLog({ args: ['plain log'] }),
        consoleLog({ type: 'debug', args: ['ws frame received'] })
      ])
      await clickLevelTab(panel, 'Logs')

      expect(texts(panel, MESSAGE)).toEqual(['plain log'])
    })

    it('narrows the list to messages containing the search text, ignoring case', async () => {
      const panel = await mountConsole(loginConsole.logs)
      await search(panel, 'SECURE')

      expect(texts(panel, MESSAGE)).toEqual([MESSAGES[1]])
    })

    it('requires both the level tab and the search text to match', async () => {
      const panel = await mountConsole(loginConsole.logs)
      await clickLevelTab(panel, 'Warnings')
      // "flash" also appears in the error row, which the level tab excludes.
      await search(panel, 'flash')

      expect(texts(panel, MESSAGE)).toEqual([RUNNER_WARN_TEXT])
    })

    it('reports that nothing matches when the search excludes every row', async () => {
      const panel = await mountConsole(loginConsole.logs)
      await search(panel, 'no such log line')

      expect(shadowAll(panel, ENTRY)).toHaveLength(0)
      expect(text(shadow(panel, FILTER_EMPTY))).toBe(
        'No logs match the current filter.'
      )
    })
  })

  describe('terminal colour codes', () => {
    it('renders a coloured runner line without its SGR codes', async () => {
      const panel = await mountConsole([loginConsole.runnerWarn])

      expect(text(shadow(panel, MESSAGE))).toBe(RUNNER_WARN_TEXT)
    })

    it('searches the stripped message rather than the colour codes', async () => {
      const panel = await mountConsole([loginConsole.runnerWarn])
      await search(panel, '33m')

      expect(shadowAll(panel, ENTRY)).toHaveLength(0)
    })
  })

  describe('empty state', () => {
    it('renders the empty state when no logs have been captured', async () => {
      const panel = await mountConsole([])

      expect(text(shadow(panel, EMPTY_STATE))).toBe(
        '📋 No console logs captured yet'
      )
    })

    it('renders the empty state before a provider supplies any logs', async () => {
      const panel = await mount<DevtoolsConsoleLogs>(PANEL)

      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(1)
      expect(shadowAll(panel, ENTRY)).toHaveLength(0)
    })

    it('renders no filter toolbar while the empty state is showing', async () => {
      const panel = await mountConsole([])

      expect(shadowAll(panel, TOOLBAR)).toHaveLength(0)
      expect(shadowAll(panel, SEARCH)).toHaveLength(0)
    })
  })
})
