import type { CommandLog } from '@wdio/devtools-shared'

import { commandCategory } from '@components/workbench/actionItems/category.js'
import { formatDuration } from '@components/workbench/actionItems/duration.js'
import '@components/workbench/logs.js'
import type { DevtoolsCommandLogs } from '@components/workbench/logs.js'

import { commandLog } from '../../support/builders.js'
import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'

const PANEL = 'wdio-devtools-logs'
const EMPTY_STATE = '.cmd-empty'
const HEAD = '.cmd-head'
const CATEGORY_DOT = '.cat-dot'
const NAME = '.cmd-name'
const DURATION = '.cmd-dur'
const REFERENCE = '.cmd-ref'
const SECTION = '.dsec'
const DESCRIPTION = '.cmd-desc'
const ROW = '.kv'
const VALUE = '.kv .v'
const EMPTY_VALUE = '.kv .v.empty'

const LOGIN_URL = 'https://the-internet.herokuapp.com/login'

/** Reference target of `navigateTo` in the pinned `@wdio/protocols`. */
const NAVIGATE_REF = 'https://w3c.github.io/webdriver/#dfn-navigate-to'

/** Wider than the value column by two orders of magnitude, and whitespace-free
 *  so the collapsed assertion compares the whole string. The panel wraps it
 *  (CSS `word-break: break-all`) and never shortens the text. */
const LONG_ARG = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUg'.repeat(40)}`

interface Section {
  title: string
  keys: string[]
  values: string[]
}

const sections = (panel: DevtoolsCommandLogs): Section[] =>
  shadowAll(panel, SECTION).map((section) => ({
    title: text(shadow(section, 'h4')),
    keys: texts(section, '.k'),
    values: texts(section, '.v')
  }))

const sectionTitles = (panel: DevtoolsCommandLogs) =>
  sections(panel).map((section) => section.title)

const sectionNamed = (panel: DevtoolsCommandLogs, title: string): Section => {
  const section = sections(panel).find((entry) => entry.title === title)
  if (!section) {
    throw new Error(`the panel rendered no "${title}" section`)
  }
  return section
}

const categoryOf = (panel: DevtoolsCommandLogs) =>
  [...(shadow(panel, CATEGORY_DOT)?.classList ?? [])].find(
    (name) => name !== 'cat-dot'
  )

const attrOf = (el: Element | null, name: string) =>
  el?.getAttribute(name) ?? null

/** A non-string value as the panel prints it, then whitespace-collapsed the way
 *  `text()` collapses the rendered cell. */
const prettyValue = (value: unknown) =>
  JSON.stringify(value, null, 2).replace(/\s+/g, ' ')

/** Property path: what the workbench does when it renders the panel directly.
 *  No protocol definition is resolved, so no description or reference exists. */
async function mountLogs(
  command?: CommandLog,
  elapsedTime?: number
): Promise<DevtoolsCommandLogs> {
  const panel = await mount<DevtoolsCommandLogs>(PANEL, {
    command,
    elapsedTime
  })
  await settle(panel)
  return panel
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (cond()) {
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** Event path: the Actions panel's row click. The handler resolves the command's
 *  protocol definition through a dynamic import before it assigns `command`,
 *  which is why this waits rather than awaiting one render. */
async function showCommand(
  panel: DevtoolsCommandLogs,
  command: CommandLog,
  elapsedTime?: number
): Promise<void> {
  window.dispatchEvent(
    new CustomEvent('show-command', { detail: { command, elapsedTime } })
  )
  await waitFor(
    () => panel.command === command,
    `the panel to pick up ${command.command}`
  )
  await settle(panel)
}

describe('wdio-devtools-logs', () => {
  describe('empty state', () => {
    it('asks for a selection while no command has been chosen', async () => {
      const panel = await mountLogs()

      expect(text(shadow(panel, EMPTY_STATE))).toBe(
        'Select a command to view its details'
      )
    })

    it('renders no header or detail sections without a command', async () => {
      const panel = await mountLogs()

      expect(shadowAll(panel, HEAD)).toHaveLength(0)
      expect(shadowAll(panel, SECTION)).toHaveLength(0)
    })

    it('replaces the empty state once a command is selected', async () => {
      const panel = await mountLogs()
      await showCommand(panel, commandLog({ command: 'getTitle', args: [] }))

      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(0)
      expect(text(shadow(panel, NAME))).toBe('getTitle')
    })
  })

  describe('header', () => {
    it('names the selected command', async () => {
      const panel = await mountLogs(commandLog({ command: 'elementClick' }))

      expect(text(shadow(panel, NAME))).toBe('elementClick')
    })

    it('marks the command with the dot of the category it belongs to', async () => {
      const commands = ['click', 'navigateTo', 'expect.toHaveText', 'getUrl']
      const panels = []
      for (const command of commands) {
        panels.push(await mountLogs(commandLog({ command })))
      }

      // Derived: the dot must follow the classifier's verdict for that command.
      expect(panels.map(categoryOf)).toEqual(
        commands.map((command) => `cat-${commandCategory(command)}`)
      )
      expect(panels.map(categoryOf)).toEqual([
        'cat-input',
        'cat-navigation',
        'cat-assertion',
        'cat-query'
      ])
    })

    it('falls back to the other category for a command it cannot classify', async () => {
      const panel = await mountLogs(commandLog({ command: 'takeScreenshot' }))

      expect(commandCategory('takeScreenshot')).toBe('other')
      expect(categoryOf(panel)).toBe('cat-other')
    })

    it("renders the command's elapsed time in human units", async () => {
      const milliseconds = await mountLogs(commandLog(), 320)
      const seconds = await mountLogs(commandLog(), 1500)

      expect(text(shadow(milliseconds, DURATION))).toBe(formatDuration(320))
      expect(text(shadow(seconds, DURATION))).toBe(formatDuration(1500))
      expect(text(shadow(milliseconds, DURATION))).toBe('320ms')
      expect(text(shadow(seconds, DURATION))).toBe('1.50s')
    })

    it('renders a zero elapsed time rather than dropping it', async () => {
      const panel = await mountLogs(commandLog(), 0)

      expect(text(shadow(panel, DURATION))).toBe(formatDuration(0))
      expect(text(shadow(panel, DURATION))).toBe('0ms')
    })

    it('renders no duration for a command selected without one', async () => {
      const panel = await mountLogs(commandLog())

      expect(shadowAll(panel, DURATION)).toHaveLength(0)
    })

    it('links to the protocol reference of a command it can resolve', async () => {
      const panel = await mountLogs()
      await showCommand(panel, commandLog({ command: 'navigateTo' }))

      const link = shadow(panel, REFERENCE)
      expect(text(link)).toBe('Reference ↗')
      expect(attrOf(link, 'href')).toBe(NAVIGATE_REF)
      expect(attrOf(link, 'target')).toBe('_blank')
    })

    it('renders no reference link for a command outside the protocols', async () => {
      const panel = await mountLogs()
      await showCommand(panel, commandLog({ command: 'click' }))

      expect(shadowAll(panel, REFERENCE)).toHaveLength(0)
    })

    it('renders no reference link when the command arrives as a property', async () => {
      // The protocol lookup lives in the `show-command` handler, so a command
      // assigned directly carries no definition.
      const panel = await mountLogs(commandLog({ command: 'navigateTo' }))

      expect(shadowAll(panel, REFERENCE)).toHaveLength(0)
    })
  })

  describe('description', () => {
    it("renders the protocol's description of the selected command", async () => {
      const panel = await mountLogs()
      await showCommand(panel, commandLog({ command: 'navigateTo' }))

      expect(sectionTitles(panel)[0]).toBe('Description')
      expect(text(shadow(panel, DESCRIPTION))).toMatch(
        /^The navigateTo \(go\) command/
      )
    })

    it('renders no description section for a command outside the protocols', async () => {
      const panel = await mountLogs()
      await showCommand(panel, commandLog({ command: 'click' }))

      expect(sectionTitles(panel)).not.toContain('Description')
      expect(shadowAll(panel, DESCRIPTION)).toHaveLength(0)
    })
  })

  describe('parameters', () => {
    it("names each argument after the protocol's parameter", async () => {
      const panel = await mountLogs()
      await showCommand(
        panel,
        commandLog({ command: 'navigateTo', args: [LOGIN_URL] })
      )

      expect(sectionNamed(panel, 'Parameters')).toEqual({
        title: 'Parameters',
        keys: ['url'],
        values: [LOGIN_URL]
      })
    })

    it('names every argument of a multi-parameter command', async () => {
      const panel = await mountLogs()
      await showCommand(
        panel,
        commandLog({
          command: 'executeScript',
          args: ['return document.title', []]
        })
      )

      const parameters = sectionNamed(panel, 'Parameters')
      expect(parameters.keys).toEqual(['script', 'args'])
      expect(parameters.values).toEqual(['return document.title', '[]'])
    })

    it('falls back to the argument position when no parameter name is known', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'setValue', args: ['#username', 'tomsmith'] })
      )

      expect(sectionNamed(panel, 'Parameters').keys).toEqual(['0', '1'])
    })

    it('pretty-prints an object argument', async () => {
      const size = { width: 1600, height: 900 }
      const panel = await mountLogs(
        commandLog({ command: 'setWindowSize', args: [size] })
      )

      expect(sectionNamed(panel, 'Parameters').values).toEqual([
        prettyValue(size)
      ])
      expect(sectionNamed(panel, 'Parameters').values).toEqual([
        '{ "width": 1600, "height": 900 }'
      ])
    })

    it('renders a null argument as null and flags the value as empty', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'deleteCookies', args: [null] })
      )

      expect(sectionNamed(panel, 'Parameters').values).toEqual(['null'])
      expect(shadowAll(panel, EMPTY_VALUE)).toHaveLength(1)
    })

    it('renders an oversized argument in full rather than truncating it', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'execute', args: [LONG_ARG] })
      )

      expect(text(shadow(panel, VALUE))).toBe(LONG_ARG)
    })

    it('renders no parameters section for a command called without arguments', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'getTitle', args: [] })
      )

      expect(sectionTitles(panel)).not.toContain('Parameters')
      expect(shadowAll(panel, ROW)).toHaveLength(0)
    })
  })

  describe('result', () => {
    it('renders one row per entry of an object result', async () => {
      const rect = { x: 8, y: 240, width: 176, height: 32 }
      const panel = await mountLogs(
        commandLog({ command: 'getElementRect', args: [], result: rect })
      )

      // One row per own entry of the result, keyed and valued by it.
      expect(sectionNamed(panel, 'Result')).toEqual({
        title: 'Result',
        keys: Object.keys(rect),
        values: Object.values(rect).map(prettyValue)
      })
      expect(sectionNamed(panel, 'Result')).toEqual({
        title: 'Result',
        keys: ['x', 'y', 'width', 'height'],
        values: ['8', '240', '176', '32']
      })
    })

    it('renders a string result as a single value row', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'getTitle', args: [], result: 'The Internet' })
      )

      expect(sectionNamed(panel, 'Result')).toEqual({
        title: 'Result',
        keys: ['value'],
        values: ['The Internet']
      })
    })

    it('keys an array result by position', async () => {
      const panel = await mountLogs(
        commandLog({
          command: 'findElements',
          args: ['css selector', 'a'],
          result: ['element-1', 'element-2']
        })
      )

      expect(sectionNamed(panel, 'Result').keys).toEqual(['0', '1'])
    })

    it('renders a false result rather than treating it as absent', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'isElementSelected', args: [], result: false })
      )

      expect(sectionNamed(panel, 'Result').values).toEqual(['false'])
    })

    it('renders an empty-string result as a row rather than dropping it', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'getText', args: [], result: '' })
      )

      expect(sectionNamed(panel, 'Result').keys).toEqual(['value'])
      expect(shadowAll(panel, EMPTY_VALUE)).toHaveLength(0)
    })

    it('renders no result section for a command that returned nothing', async () => {
      const panel = await mountLogs(
        commandLog({ command: 'elementClick', args: [], result: null })
      )

      expect(sectionTitles(panel)).not.toContain('Result')
    })
  })

  describe('section order', () => {
    it('renders the description, then the parameters, then the result', async () => {
      const panel = await mountLogs()
      await showCommand(
        panel,
        commandLog({
          command: 'navigateTo',
          args: [LOGIN_URL],
          result: 'ok'
        }),
        640
      )

      expect(sectionTitles(panel)).toEqual([
        'Description',
        'Parameters',
        'Result'
      ])
      expect(text(shadow(panel, DURATION))).toBe('640ms')
    })

    it('replaces the rendered detail when another command is selected', async () => {
      const panel = await mountLogs()
      await showCommand(
        panel,
        commandLog({ command: 'navigateTo', args: [LOGIN_URL] })
      )
      await showCommand(
        panel,
        commandLog({ command: 'getTitle', args: [], result: 'The Internet' })
      )

      expect(text(shadow(panel, NAME))).toBe('getTitle')
      expect(sectionTitles(panel)).toEqual(['Description', 'Result'])
    })
  })
})
