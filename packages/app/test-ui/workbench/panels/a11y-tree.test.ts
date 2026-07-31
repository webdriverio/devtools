import type { CommandLog } from '@wdio/devtools-shared'

import '@components/workbench/a11y-tree.js'
import type { DevtoolsA11yTree } from '@components/workbench/a11y-tree.js'

import { commandLog } from '../../support/builders.js'
import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  headerlessSnapshot,
  headerOnlySnapshot,
  LOGIN_DEPTHS,
  LOGIN_LOCATOR,
  LOGIN_LOCATOR_ALIAS,
  LOGIN_LOCATORS,
  LOGIN_NAMES,
  LOGIN_ROLES,
  loginCommand,
  loginSnapshot,
  LONG_NAME,
  longNameSnapshot,
  PAGE_HEADER,
  PASSWORD_LOCATOR,
  snapshotlessCommand,
  USERNAME_LOCATOR
} from './a11y-fixtures.js'

const PANEL = 'wdio-devtools-a11y'
const NODE = '.node'
const PICKABLE_NODE = '.node.pick'
const HOT_NODE = '.node.hot'
const ROLE = '.role'
const NAME = '.nm'
const LOCATOR = '.sel'
const HEADER = '.hdr'
const TREE = '.tree'
const COPYBAR = '.copybar'
const HINT_LEAD = '.copybar .lead'
const HINT_LOCATOR = '.copybar .loc'
const HINT_IDLE = '.copybar .idle'
const HINT_CONFIRMATION = '.copybar .ok'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const EMPTY_ICON = '.empty-state-icon'
const EMPTY_HEADING = '.empty-state-text'
const EMPTY_DETAIL = '.empty-state-detail'
const SKELETON = '.ph-item'

/** Glyph the panel hands its empty-state placeholder. */
const TREE_GLYPH = '🌳'

/** Why a trace can reach this panel with commands that carry no snapshot —
 *  per-command accessibility capture is WDIO-only. */
const CAPTURE_UNSUPPORTED =
  'Per-command accessibility capture is WebdriverIO-only — Selenium and Nightwatch traces do not include it.'

/** The copy shown before anything is selected, which is not a capture gap. */
const NOTHING_SELECTED =
  'Select a command in the Actions tab to see the accessibility tree captured for it.'

/** Rendered row of the first textbox — the tree drops the `∈ "purpose"` suffix
 *  the serializer wrote before the locator. */
const USERNAME_ROW_TEXT = `• textbox "Username" ${USERNAME_LOCATOR}`

/** Row index per fixture node, in capture order. */
const HEADING_ROW = 1
const FORM_ROW = 2
const USERNAME_ROW = 3

interface RevealDetail {
  selector?: string
  label?: string
  pin?: boolean
}

interface HighlightDetail {
  selector?: string
}

const rows = (panel: DevtoolsA11yTree) => shadowAll<HTMLElement>(panel, NODE)

const rowAt = (panel: DevtoolsA11yTree, index: number): HTMLElement => {
  const row = rows(panel)[index]
  if (!row) {
    throw new Error(`no a11y node row at index ${index}`)
  }
  return row
}

const indents = (panel: DevtoolsA11yTree) =>
  rows(panel).map((row) => row.style.paddingLeft)

const attrOf = (el: Element, name: string) => el.getAttribute(name)

/** The panel takes no properties: it follows the same `show-command` event the
 *  snapshot pane listens to. */
async function showCommand(
  panel: DevtoolsA11yTree,
  command: CommandLog
): Promise<void> {
  window.dispatchEvent(new CustomEvent('show-command', { detail: { command } }))
  await settle(panel)
}

async function mountTree(snapshotText?: string): Promise<DevtoolsA11yTree> {
  const panel = await mount<DevtoolsA11yTree>(PANEL)
  if (snapshotText !== undefined) {
    await showCommand(panel, commandLog({ snapshotText }))
  }
  return panel
}

/** The snapshot pane pointing back at a row: transient on overlay-box hover,
 *  pinned on click. */
async function reveal(
  panel: DevtoolsA11yTree,
  detail: RevealDetail | null
): Promise<void> {
  window.dispatchEvent(new CustomEvent('a11y-reveal', { detail }))
  await settle(panel)
}

async function hover(panel: DevtoolsA11yTree, index: number): Promise<void> {
  rowAt(panel, index).dispatchEvent(new MouseEvent('mouseenter'))
  await settle(panel)
}

async function unhover(panel: DevtoolsA11yTree, index: number): Promise<void> {
  rowAt(panel, index).dispatchEvent(new MouseEvent('mouseleave'))
  await settle(panel)
}

/** Lets the awaited clipboard write inside the click handler settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function clickRow(panel: DevtoolsA11yTree, index: number): Promise<void> {
  rowAt(panel, index).click()
  await flush()
  await settle(panel)
}

/** The panel copies through `navigator.clipboard`, which a headless run has no
 *  user gesture or permission for; the writes are recorded instead. */
function recordClipboard(options: { failing?: boolean } = {}): string[] {
  const writes: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (data: string): Promise<void> => {
        if (options.failing) {
          return Promise.reject(new Error('clipboard write blocked'))
        }
        writes.push(data)
        return Promise.resolve()
      }
    }
  })
  return writes
}

describe('wdio-devtools-a11y', () => {
  /** Outbound outline requests to the snapshot pane, newest last. */
  const highlights: (HighlightDetail | null)[] = []
  const recordHighlight = (event: Event) => {
    highlights.push((event as CustomEvent<HighlightDetail | null>).detail)
  }
  const lastHighlight = () => highlights[highlights.length - 1]

  beforeEach(() => {
    highlights.length = 0
    window.addEventListener('a11y-highlight', recordHighlight)
  })

  afterEach(() => {
    window.removeEventListener('a11y-highlight', recordHighlight)
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  describe('tree', () => {
    it('renders one row per captured node', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(rows(panel)).toHaveLength(LOGIN_ROLES.length)
    })

    it('renders the role of every node in capture order', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(texts(panel, ROLE)).toEqual(LOGIN_ROLES)
    })

    it('quotes the accessible name of the nodes that have one', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(texts(panel, NAME)).toEqual(LOGIN_NAMES)
    })

    it('renders no name for a container captured without one', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(shadowAll(rowAt(panel, FORM_ROW), NAME)).toHaveLength(0)
      expect(text(shadow(rowAt(panel, FORM_ROW), ROLE))).toBe('form')
    })

    it('indents each row by the depth of its node', async () => {
      const panel = await mountTree(loginSnapshot)

      // Derived from the captured depths, so a row indented by its render
      // position rather than its nesting fails: rows 2 and 7 are both depth 1
      // but four apart in the list.
      expect(indents(panel)).toEqual(
        LOGIN_DEPTHS.map((depth) => `${8 + depth * 16}px`)
      )
      expect(indents(panel)).toEqual([
        '8px',
        '24px',
        '24px',
        '40px',
        '40px',
        '40px',
        '24px'
      ])
    })

    it("keeps a heading's level in its role", async () => {
      const panel = await mountTree(loginSnapshot)

      expect(text(shadow(rowAt(panel, HEADING_ROW), ROLE))).toBe('heading[2]')
    })

    it('drops the inferred purpose from a row that carried one', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(text(rowAt(panel, USERNAME_ROW))).toBe(USERNAME_ROW_TEXT)
    })

    it('renders the page title and URL above the tree', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(text(shadow(panel, HEADER))).toBe(PAGE_HEADER)
    })

    it('renders no page header for a capture that has none', async () => {
      const panel = await mountTree(headerlessSnapshot)

      expect(shadowAll(panel, HEADER)).toHaveLength(0)
      expect(texts(panel, ROLE)).toEqual(['document', 'button'])
    })

    it('renders an empty tree for a page captured with no nodes', async () => {
      const panel = await mountTree(headerOnlySnapshot)

      expect(shadowAll(panel, TREE)).toHaveLength(1)
      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(0)
      expect(rows(panel)).toHaveLength(0)
    })

    it('ignores the trailing blank line of a captured snapshot', async () => {
      const panel = await mountTree(`${loginSnapshot}\n`)

      expect(rows(panel)).toHaveLength(LOGIN_ROLES.length)
    })

    it('shortens an accessible name past the row budget', async () => {
      const panel = await mountTree(longNameSnapshot)

      // 64 characters including the ellipsis that replaces the rest.
      expect(text(shadow(panel, NAME))).toBe(`"${LONG_NAME.slice(0, 63)}…"`)
    })

    it('keeps the locator of a row whose name was shortened', async () => {
      const panel = await mountTree(longNameSnapshot)

      expect(text(shadow(panel, LOCATOR))).toBe(LOGIN_LOCATOR)
    })
  })

  describe('locators', () => {
    it('marks only the nodes that carry a locator as pickable', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(shadowAll(panel, PICKABLE_NODE)).toHaveLength(
        LOGIN_LOCATORS.length
      )
      expect(shadowAll(panel, PICKABLE_NODE)).toHaveLength(3)
    })

    it('renders the captured locator of every pickable row', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(texts(panel, LOCATOR)).toEqual(LOGIN_LOCATORS)
      expect(texts(panel, LOCATOR)).toEqual([
        USERNAME_LOCATOR,
        PASSWORD_LOCATOR,
        LOGIN_LOCATOR
      ])
    })

    it('names the copy affordance in the title of a pickable row', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(attrOf(rowAt(panel, USERNAME_ROW), 'title')).toBe(
        `Click to copy locator: ${USERNAME_LOCATOR}`
      )
    })

    it('leaves a row without a locator untitled and unpickable', async () => {
      const panel = await mountTree(loginSnapshot)

      const row = rowAt(panel, FORM_ROW)
      expect(attrOf(row, 'title')).toBe(null)
      expect(row.classList.contains('pick')).toBe(false)
    })
  })

  describe('hovering a row', () => {
    it('prompts for a hover until one happens', async () => {
      const panel = await mountTree(loginSnapshot)

      expect(text(shadow(panel, HINT_IDLE))).toBe(
        'Hover a node to preview its locator — click to copy'
      )
    })

    it('asks the snapshot pane to outline the hovered element', async () => {
      const panel = await mountTree(loginSnapshot)
      await hover(panel, USERNAME_ROW)

      expect(lastHighlight()).toEqual({ selector: USERNAME_LOCATOR })
    })

    it('echoes the hovered locator in the copy hint', async () => {
      const panel = await mountTree(loginSnapshot)
      await hover(panel, USERNAME_ROW)

      expect(text(shadow(panel, HINT_LEAD))).toBe('Click to copy locator:')
      expect(text(shadow(panel, HINT_LOCATOR))).toBe(USERNAME_LOCATOR)
    })

    it('clears the outline when the cursor leaves the row', async () => {
      const panel = await mountTree(loginSnapshot)
      await hover(panel, USERNAME_ROW)
      await unhover(panel, USERNAME_ROW)

      expect(lastHighlight()).toBe(null)
      expect(shadowAll(panel, HINT_IDLE)).toHaveLength(1)
    })

    it('clears the outline when a row with no locator is hovered', async () => {
      const panel = await mountTree(loginSnapshot)
      await hover(panel, FORM_ROW)

      expect(lastHighlight()).toBe(null)
    })
  })

  describe('copying a locator', () => {
    it('copies the locator of the clicked row', async () => {
      const writes = recordClipboard()
      const panel = await mountTree(loginSnapshot)
      await clickRow(panel, USERNAME_ROW)

      expect(writes).toEqual([USERNAME_LOCATOR])
    })

    it('confirms the copy on the row and in the hint', async () => {
      recordClipboard()
      const panel = await mountTree(loginSnapshot)
      await clickRow(panel, USERNAME_ROW)

      expect(text(shadow(rowAt(panel, USERNAME_ROW), LOCATOR))).toBe('copied ✓')
      expect(text(shadow(panel, HINT_CONFIRMATION))).toBe('✓ Copied')
      expect(text(shadow(panel, HINT_LOCATOR))).toBe(USERNAME_LOCATOR)
    })

    it('confirms the copy on the clicked row only', async () => {
      recordClipboard()
      const panel = await mountTree(loginSnapshot)
      await clickRow(panel, USERNAME_ROW)

      expect(texts(panel, LOCATOR)).toEqual([
        'copied ✓',
        ...LOGIN_LOCATORS.slice(1)
      ])
      expect(texts(panel, LOCATOR)).toEqual([
        'copied ✓',
        PASSWORD_LOCATOR,
        LOGIN_LOCATOR
      ])
    })

    it('copies nothing when a row with no locator is clicked', async () => {
      const writes = recordClipboard()
      const panel = await mountTree(loginSnapshot)
      await clickRow(panel, FORM_ROW)

      expect(writes).toEqual([])
      expect(shadowAll(panel, HINT_CONFIRMATION)).toHaveLength(0)
    })

    it('shows no confirmation when the clipboard rejects the write', async () => {
      recordClipboard({ failing: true })
      const panel = await mountTree(loginSnapshot)
      await clickRow(panel, USERNAME_ROW)

      expect(text(shadow(rowAt(panel, USERNAME_ROW), LOCATOR))).toBe(
        USERNAME_LOCATOR
      )
      expect(shadowAll(panel, HINT_CONFIRMATION)).toHaveLength(0)
    })
  })

  describe('reveal from the snapshot pane', () => {
    it('highlights the row whose locator the pane points at', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: PASSWORD_LOCATOR })

      const hot = shadowAll(panel, HOT_NODE)
      expect(hot).toHaveLength(1)
      expect(text(shadow(hot[0], NAME))).toBe('"Password"')
    })

    it("falls back to the element's name when the pane's locator differs", async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: LOGIN_LOCATOR_ALIAS, label: 'Login' })

      const hot = shadowAll(panel, HOT_NODE)
      expect(hot).toHaveLength(1)
      expect(text(shadow(hot[0], ROLE))).toBe('button')
    })

    it('names the revealed locator in the copy hint', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: PASSWORD_LOCATOR })

      expect(text(shadow(panel, HINT_LOCATOR))).toBe(PASSWORD_LOCATOR)
    })

    it('highlights nothing when the pane points outside the captured tree', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: '#flash', label: 'You logged in' })

      expect(shadowAll(panel, HOT_NODE)).toHaveLength(0)
    })

    it('clears the highlight when the pane clears its own', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: PASSWORD_LOCATOR })
      await reveal(panel, null)

      expect(shadowAll(panel, HOT_NODE)).toHaveLength(0)
    })

    it('keeps a pinned row highlighted while another row is revealed', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: LOGIN_LOCATOR, pin: true })
      await reveal(panel, { selector: USERNAME_LOCATOR })

      expect(shadowAll(panel, HOT_NODE)).toHaveLength(2)
    })

    it('drops the pin when another command is selected', async () => {
      const panel = await mountTree(loginSnapshot)
      await reveal(panel, { selector: LOGIN_LOCATOR, pin: true })
      await showCommand(
        panel,
        commandLog({ command: 'getText', snapshotText: loginSnapshot })
      )

      expect(rows(panel)).toHaveLength(LOGIN_ROLES.length)
      expect(shadowAll(panel, HOT_NODE)).toHaveLength(0)
    })
  })

  describe('unavailable snapshot', () => {
    it('renders the placeholder before a command is selected', async () => {
      const panel = await mountTree()

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, COPYBAR)).toHaveLength(0)
      expect(rows(panel)).toHaveLength(0)
    })

    it('renders the placeholder for a command captured without a snapshot', async () => {
      // Per-command a11y capture is WDIO-only, so Selenium and Nightwatch
      // traces reach this panel with commands that carry no `snapshotText`.
      const panel = await mountTree()
      await showCommand(panel, snapshotlessCommand)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, COPYBAR)).toHaveLength(0)
      expect(rows(panel)).toHaveLength(0)
    })

    it('names the missing capture as the reason a selected command has no tree', async () => {
      const panel = await mountTree()
      await showCommand(panel, snapshotlessCommand)
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(
        'No accessibility snapshot for this command'
      )
      expect(text(shadow(placeholder, EMPTY_DETAIL))).toBe(CAPTURE_UNSUPPORTED)
      expect(text(shadow(placeholder, EMPTY_ICON))).toBe(TREE_GLYPH)
    })

    it('prompts for a selection rather than blaming capture when nothing is selected', async () => {
      const panel = await mountTree()
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(
        'No command selected'
      )
      expect(text(shadow(placeholder, EMPTY_DETAIL))).toBe(NOTHING_SELECTED)
    })

    it('explains the empty panel instead of drawing a loading skeleton', async () => {
      const panel = await mountTree()
      await showCommand(panel, snapshotlessCommand)

      expect(shadowAll(shadow(panel, PLACEHOLDER)!, SKELETON)).toHaveLength(0)
    })

    it('falls back to the placeholder when a snapshotless command follows one with a snapshot', async () => {
      const panel = await mountTree()
      await showCommand(panel, loginCommand)
      await showCommand(panel, snapshotlessCommand)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(rows(panel)).toHaveLength(0)
    })

    it('renders the placeholder for a command whose snapshot came back empty', async () => {
      const panel = await mountTree('')

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(rows(panel)).toHaveLength(0)
    })

    it('renders the placeholder when the selection is cleared', async () => {
      const panel = await mountTree(loginSnapshot)
      window.dispatchEvent(new CustomEvent('show-command', { detail: {} }))
      await settle(panel)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(rows(panel)).toHaveLength(0)
    })
  })
})
