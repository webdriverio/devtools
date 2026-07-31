import type { CommandLog } from '@wdio/devtools-shared'

import { commandContext, sourceContext } from '@/controller/context.js'
import { commandCategory } from '@components/workbench/actionItems/category.js'
import '@components/workbench/source.js'
import type { DevtoolsSource } from '@components/workbench/source.js'

import { commandLog } from '../../support/builders.js'
import { mount, mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  HELPER_CALL_SOURCE,
  NAVIGATE_CALL_SOURCE,
  SET_VALUE_CALL_SOURCE,
  SPEC_FILE,
  SPEC_LINES,
  SET_VALUE_LINE,
  STEPS_CALL_SOURCE,
  STEPS_LINES,
  STEPS_SET_VALUE_LINE,
  loginSourceCommands,
  loginSources
} from './fixtures.js'

const PANEL = 'wdio-devtools-source'
const FILE_TAB = '.src-file'
const ACTIVE_FILE_TAB = '.src-file.active'
const PATH = '.src-path'
const BASE = '.src-path .base'
const ELISION = '.src-path .sep'
const ACTION = '.src-act'
const EDITOR_LINK = 'a.src-act'
const CHIP = '.cs-chip'
const CHIP_COMMAND = '.cs-chip .cmd'
const CHIP_LINE = '.cs-chip .ln'
const EDITOR = '.cm-editor'
const LINE = '.cm-line'
const CALL_SITE = '.cm-line.cm-callsite'
const NOT_CAPTURED = '.src-empty'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const EMPTY_ICON = '.empty-state-icon'
const EMPTY_HEADING = '.empty-state-text'
const EMPTY_DETAIL = '.empty-state-detail'
const SKELETON = '.ph-item'

/** Copy the panel hands its placeholder — a terminal state whenever the run
 *  captured no source and no command reported a call site. */
const EMPTY_GLYPH = '📄'
const EMPTY_HEADING_TEXT = 'No source to show'
const EMPTY_DETAIL_TEXT =
  "A file appears here once the run captures a spec's source or a command reports the line it ran from — this run carries neither."

/** Theme token the panel exposes as `--cs`, per `ActionCategory`. Mirrors
 *  `source.ts`'s `CATEGORY_VAR`, which is module-private; `none` is the value
 *  the panel writes when there is no call site at all. */
const CATEGORY_COLOUR = {
  navigation: 'var(--vscode-charts-blue)',
  input: 'var(--vscode-charts-purple)',
  assertion: 'var(--vscode-charts-green)',
  query: 'var(--vscode-charts-yellow)',
  other: 'var(--vscode-descriptionForeground)',
  none: 'var(--vscode-descriptionForeground)'
}

/** The tint a command's call site should get — looked up by the classifier's
 *  verdict for that command, so a panel tinting by anything else fails. */
const tintFor = (command: string) => CATEGORY_COLOUR[commandCategory(command)]

/** Last three segments of a path, elided, as the toolbar shows it. */
const elidedPath = (path: string) => {
  const segments = path.split('/').filter(Boolean)
  const shown = segments.slice(-3)
  return `${segments.length > shown.length ? '…/' : ''}${shown.join('/')}`
}

/** `text()` collapses whitespace, so a rendered editor line is compared against
 *  its source line collapsed the same way. */
const collapsed = (line: string) => line.replace(/\s+/g, ' ').trim()

/** CodeMirror measures its viewport in a rAF — give it one before reading the
 *  lines it rendered. */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function mountSource(
  sources: Record<string, string>,
  commands: CommandLog[] = []
): Promise<DevtoolsSource> {
  const panel = await mountWithContext<DevtoolsSource>(PANEL, [
    { context: sourceContext, value: sources },
    { context: commandContext, value: commands }
  ])
  await settle(panel)
  await nextFrame()
  return panel
}

async function highlight(panel: DevtoolsSource, callSource: string) {
  window.dispatchEvent(
    new CustomEvent('app-source-highlight', { detail: callSource })
  )
  await settle(panel)
  await nextFrame()
}

async function track(panel: DevtoolsSource, callSource: string) {
  window.dispatchEvent(
    new CustomEvent('app-source-track', { detail: { callSource } })
  )
  await settle(panel)
  await nextFrame()
}

async function openFile(panel: DevtoolsSource, basename: string) {
  const tab = shadowAll(panel, FILE_TAB).find(
    (candidate) => text(candidate) === basename
  )
  if (!tab) {
    throw new Error(`no file tab labelled "${basename}"`)
  }
  tab.click()
  await settle(panel)
  await nextFrame()
}

const callSiteColour = (panel: DevtoolsSource) =>
  panel.style.getPropertyValue('--cs')

describe('wdio-devtools-source', () => {
  describe('file tabs', () => {
    it('renders a tab per captured source file, labelled by file name', async () => {
      const panel = await mountSource(loginSources)

      expect(texts(panel, FILE_TAB)).toEqual(['login.e2e.ts', 'login.steps.ts'])
    })

    it('adds a file that only a command call source names', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)

      expect(texts(panel, FILE_TAB)).toEqual([
        'login.e2e.ts',
        'login.steps.ts',
        'helpers.ts'
      ])
    })

    it('marks the first captured file active until another is picked', async () => {
      const panel = await mountSource(loginSources)

      expect(texts(panel, ACTIVE_FILE_TAB)).toEqual(['login.e2e.ts'])
    })

    it('moves the active mark to the file that was clicked', async () => {
      const panel = await mountSource(loginSources)
      await openFile(panel, 'login.steps.ts')

      expect(texts(panel, ACTIVE_FILE_TAB)).toEqual(['login.steps.ts'])
    })
  })

  describe('path', () => {
    it('shows the last three segments of the active path, marking the elision', async () => {
      const panel = await mountSource(loginSources)

      expect(text(shadow(panel, PATH))).toBe(elidedPath(SPEC_FILE))
      expect(text(shadow(panel, PATH))).toBe('…/test/specs/login.e2e.ts')
      expect(text(shadow(panel, BASE))).toBe('login.e2e.ts')
    })

    it('keeps the whole path in the hover title', async () => {
      const panel = await mountSource(loginSources)

      expect(shadow(panel, PATH)?.getAttribute('title')).toBe(SPEC_FILE)
    })

    it('shows a path short enough to fit whole, with no elision', async () => {
      const panel = await mountSource({ 'login.e2e.ts': SPEC_LINES.join('\n') })

      expect(text(shadow(panel, PATH))).toBe(elidedPath('login.e2e.ts'))
      expect(text(shadow(panel, PATH))).toBe('login.e2e.ts')
      expect(shadowAll(panel, ELISION)).toHaveLength(0)
    })

    it('offers copy-path and open-in-editor actions', async () => {
      const panel = await mountSource(loginSources)

      expect(texts(panel, ACTION)).toEqual(['Copy path', 'Open in editor'])
    })
  })

  describe('editor', () => {
    it('renders the captured source of the active file', async () => {
      const panel = await mountSource(loginSources)

      expect(texts(panel, LINE)).toEqual(SPEC_LINES.map(collapsed))
    })

    it('renders the source of the file the tabs switch to', async () => {
      const panel = await mountSource(loginSources)
      await openFile(panel, 'login.steps.ts')

      expect(texts(panel, LINE)).toEqual(STEPS_LINES.map(collapsed))
      expect(text(shadow(panel, BASE))).toBe('login.steps.ts')
    })

    it('reports a file the trace never captured instead of an editor', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await openFile(panel, 'helpers.ts')

      expect(text(shadow(panel, NOT_CAPTURED))).toBe(
        'Source for helpers.ts was not captured in this trace.'
      )
      expect(shadowAll(panel, EDITOR)).toHaveLength(0)
    })

    it('keeps the file tabs while reporting an uncaptured file', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await openFile(panel, 'helpers.ts')

      expect(texts(panel, ACTIVE_FILE_TAB)).toEqual(['helpers.ts'])
      expect(texts(panel, FILE_TAB)).toHaveLength(3)
    })

    it('reports the uncaptured file a command named when nothing was captured', async () => {
      const panel = await mountSource({}, [
        commandLog({ command: 'getTitle', callSource: HELPER_CALL_SOURCE })
      ])

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(0)
      expect(text(shadow(panel, NOT_CAPTURED))).toBe(
        'Source for helpers.ts was not captured in this trace.'
      )
    })
  })

  describe('call site', () => {
    it('highlights the line a source-highlight event names', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SET_VALUE_CALL_SOURCE)

      expect(texts(panel, CALL_SITE)).toEqual([
        collapsed(SPEC_LINES[SET_VALUE_LINE - 1])
      ])
    })

    it('highlights the line a passive source-track event names', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await track(panel, SET_VALUE_CALL_SOURCE)

      expect(texts(panel, CALL_SITE)).toEqual([
        collapsed(SPEC_LINES[SET_VALUE_LINE - 1])
      ])
    })

    it('opens the call source file before highlighting it', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, STEPS_CALL_SOURCE)

      expect(texts(panel, ACTIVE_FILE_TAB)).toEqual(['login.steps.ts'])
      expect(texts(panel, CALL_SITE)).toEqual([
        collapsed(STEPS_LINES[STEPS_SET_VALUE_LINE - 1])
      ])
    })

    it('names the command and line of the call site in a chip', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SET_VALUE_CALL_SOURCE)

      expect(text(shadow(panel, CHIP_COMMAND))).toBe('setValue')
      expect(text(shadow(panel, CHIP_LINE))).toBe(`L${SET_VALUE_LINE}`)
    })

    it('tints the call site with the category of the command that ran there', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SET_VALUE_CALL_SOURCE)

      expect(callSiteColour(panel)).toBe(tintFor('setValue'))
      expect(callSiteColour(panel)).toBe(CATEGORY_COLOUR.input)
    })

    it('tints a navigation call site with its own category colour', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, NAVIGATE_CALL_SOURCE)

      expect(text(shadow(panel, CHIP_COMMAND))).toBe('url')
      expect(callSiteColour(panel)).toBe(tintFor('url'))
      expect(callSiteColour(panel)).toBe(CATEGORY_COLOUR.navigation)
      // The two categories really are distinct tints, so the assertion above
      // isn't satisfied by a panel that hard-codes one colour.
      expect(tintFor('url')).not.toBe(tintFor('setValue'))
    })

    it('highlights a line no command ran on without naming one', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, `${SPEC_FILE}:4:1`)

      expect(texts(panel, CALL_SITE)).toEqual([collapsed(SPEC_LINES[3])])
      expect(shadowAll(panel, CHIP)).toHaveLength(0)
    })

    it('highlights nothing for a line past the end of the file', async () => {
      const panel = await mountSource(loginSources, [
        commandLog({ command: 'click', callSource: `${SPEC_FILE}:99:3` })
      ])
      await highlight(panel, `${SPEC_FILE}:99:3`)

      expect(shadowAll(panel, CALL_SITE)).toHaveLength(0)
      expect(text(shadow(panel, CHIP_LINE))).toBe('L99')
    })

    it('ignores a call source that carries no line number', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SPEC_FILE)

      expect(shadowAll(panel, CALL_SITE)).toHaveLength(0)
      expect(shadowAll(panel, CHIP)).toHaveLength(0)
      expect(texts(panel, ACTIVE_FILE_TAB)).toEqual(['login.e2e.ts'])
    })

    it('clears the highlight when another file is opened', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SET_VALUE_CALL_SOURCE)
      await openFile(panel, 'login.steps.ts')

      expect(shadowAll(panel, CALL_SITE)).toHaveLength(0)
      expect(shadowAll(panel, CHIP)).toHaveLength(0)
      expect(callSiteColour(panel)).toBe(CATEGORY_COLOUR.none)
    })

    it('points the editor link at the call-site line', async () => {
      const panel = await mountSource(loginSources, loginSourceCommands)
      await highlight(panel, SET_VALUE_CALL_SOURCE)

      expect(shadow(panel, EDITOR_LINK)?.getAttribute('href')).toBe(
        `vscode://file/${SPEC_FILE}:${SET_VALUE_LINE}`
      )
    })

    it('points the editor link at the file itself before any call site', async () => {
      const panel = await mountSource(loginSources)

      expect(shadow(panel, EDITOR_LINK)?.getAttribute('href')).toBe(
        `vscode://file/${SPEC_FILE}`
      )
    })
  })

  describe('empty state', () => {
    it('renders the placeholder when no source and no call source was captured', async () => {
      const panel = await mountSource({}, [
        commandLog({ callSource: undefined })
      ])

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, FILE_TAB)).toHaveLength(0)
    })

    // Read inside the placeholder's own shadow root: the panel's `textContent`
    // stops at the placeholder's host, so it reads empty whether or not the
    // words render — which is how inert copy went unnoticed.
    it('says why there is no file to show', async () => {
      const panel = await mountSource({}, [
        commandLog({ callSource: undefined })
      ])
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(EMPTY_HEADING_TEXT)
      expect(text(shadow(placeholder, EMPTY_DETAIL))).toBe(EMPTY_DETAIL_TEXT)
      expect(text(shadow(placeholder, EMPTY_ICON))).toBe(EMPTY_GLYPH)
    })

    // Distinct from the uncaptured-file notice above: that one names a file the
    // commands pointed at, this one is the no-file-at-all state.
    it('explains the empty panel instead of drawing a loading skeleton', async () => {
      const panel = await mountSource({}, [
        commandLog({ callSource: undefined })
      ])
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(placeholder, SKELETON)).toHaveLength(0)
      expect(shadowAll(panel, NOT_CAPTURED)).toHaveLength(0)
    })

    it('renders the placeholder before a provider supplies anything', async () => {
      const panel = await mount<DevtoolsSource>(PANEL)
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(EMPTY_HEADING_TEXT)
    })
  })
})
