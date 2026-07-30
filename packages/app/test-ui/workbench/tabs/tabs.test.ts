import '@components/tabs.js'
import type { DevtoolsTab, DevtoolsTabs } from '@components/tabs.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'

const TAG = 'wdio-devtools-tabs'
const NAV = 'nav'
const TAB_BUTTON = 'nav button'
const TAB_LABEL = 'nav button > span:first-child'
const BADGE = '.tab-badge'
const ACTIVE_BUTTON = 'nav button.tab-btn--active'

const CACHE_ID = 'test-active-dock-tab'

interface TabSpec {
  label: string
  badge?: number
  badgeTone?: string
  active?: boolean
}

/**
 * One tabs child as the workbench declares it: `label`, `badgeTone` and `active`
 * are ATTRIBUTES, and the count is left out of the markup — the workbench binds
 * it as a property (`.badge="${…}"` in workbench.ts), so `mountTabs` assigns it
 * that way instead of routing it through Lit's attribute converter.
 */
function markupFor(tabs: TabSpec[]): string {
  return tabs
    .map(
      ({ label, badgeTone, active }) =>
        `<wdio-devtools-tab label="${label}"` +
        (badgeTone === undefined ? '' : ` badgeTone="${badgeTone}"`) +
        (active ? ' active' : '') +
        `><p>${label} panel</p></wdio-devtools-tab>`
    )
    .join('')
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface MountOptions {
  cacheId?: string
  /** Markup appended after the tabs, for the bar's named `actions` slot. */
  extraMarkup?: string
}

/** The bar builds its tab list in a `setTimeout` from `connectedCallback` — it
 *  waits for its light DOM to be parsed — so the nav only exists a macrotask
 *  after the mount resolves. */
async function mountTabs(
  tabs: TabSpec[],
  options: MountOptions = {}
): Promise<DevtoolsTabs> {
  const el = await mount<DevtoolsTabs>(TAG, {
    innerHTML: markupFor(tabs) + (options.extraMarkup ?? ''),
    ...(options.cacheId === undefined ? {} : { cacheId: options.cacheId })
  })
  panels(el).forEach((panel, index) => {
    const badge = tabs[index]?.badge
    if (badge !== undefined) {
      panel.badge = badge
    }
  })
  await nextTask()
  await settle(el)
  return el
}

/** The bar polls its children for badge changes every 250ms rather than
 *  observing them, so a count that changes after mount lands a tick later. */
async function nextBadgePoll(el: DevtoolsTabs): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 300))
  await settle(el)
}

const panels = (el: DevtoolsTabs) =>
  Array.from(el.querySelectorAll<DevtoolsTab>('wdio-devtools-tab'))

const activePanels = (el: DevtoolsTabs) =>
  panels(el)
    .filter((panel) => panel.hasAttribute('active'))
    .map((panel) => panel.getAttribute('label'))

const openTab = (label?: string) =>
  window.dispatchEvent(new CustomEvent('open-dock-tab', { detail: { label } }))

function tabButton(el: DevtoolsTabs, label: string): HTMLButtonElement {
  const found = shadowAll<HTMLButtonElement>(el, TAB_BUTTON).find((button) =>
    text(button).startsWith(label)
  )
  if (!found) {
    throw new Error(`no tab button rendered for "${label}"`)
  }
  return found
}

/** The workbench's own dock: an unbadged tab, a counted one, and the Errors tab
 *  which is the only one that asks for the danger tint. */
const DOCK: TabSpec[] = [
  { label: 'Source' },
  { label: 'Console', badge: 4 },
  { label: 'Errors', badge: 2, badgeTone: 'danger' }
]

describe('wdio-devtools-tabs', () => {
  afterEach(() => localStorage.removeItem(CACHE_ID))

  describe('the tab strip', () => {
    it('renders one button per labelled child, in child order', async () => {
      const el = await mountTabs(DOCK)

      expect(texts(el, TAB_LABEL)).toEqual(['Source', 'Console', 'Errors'])
    })

    it('opens the first tab when no child claims to be active', async () => {
      const el = await mountTabs(DOCK)

      expect(text(shadow(el, ACTIVE_BUTTON))).toBe('Source')
      expect(activePanels(el)).toEqual(['Source'])
    })

    it('opens the child that claims to be active instead of the first', async () => {
      const el = await mountTabs([
        { label: 'Source' },
        { label: 'Console', active: true }
      ])

      expect(text(shadow(el, ACTIVE_BUTTON))).toContain('Console')
      expect(activePanels(el)).toEqual(['Console'])
    })

    it('renders a single tab as the active one', async () => {
      const el = await mountTabs([{ label: 'Source' }])

      expect(shadowAll(el, TAB_BUTTON)).toHaveLength(1)
      expect(activePanels(el)).toEqual(['Source'])
    })

    it('renders no strip at all without any tabs', async () => {
      const el = await mountTabs([])

      expect(shadowAll(el, NAV)).toHaveLength(0)
      expect(shadowAll(el, TAB_BUTTON)).toHaveLength(0)
    })

    it('keeps a slotted action out of the tab list', async () => {
      const el = await mountTabs([{ label: 'Source' }], {
        extraMarkup: '<nav slot="actions"><button>collapse</button></nav>'
      })

      expect(texts(el, TAB_LABEL)).toEqual(['Source'])
    })

    it('adds a button for a tab that mounts after the strip', async () => {
      const el = await mountTabs([{ label: 'Source' }])

      const compare = document.createElement('wdio-devtools-tab')
      compare.setAttribute('label', 'Compare')
      el.append(compare)
      await nextTask()
      await settle(el)

      expect(texts(el, TAB_LABEL)).toEqual(['Source', 'Compare'])
      expect(activePanels(el)).toEqual(['Source'])
    })
  })

  describe('switching tabs', () => {
    it('opens the tab whose button is clicked', async () => {
      const el = await mountTabs(DOCK)

      tabButton(el, 'Console').click()
      await settle(el)

      expect(text(shadow(el, ACTIVE_BUTTON))).toContain('Console')
      expect(activePanels(el)).toEqual(['Console'])
    })

    it('marks only one button active at a time', async () => {
      const el = await mountTabs(DOCK)

      tabButton(el, 'Errors').click()
      await settle(el)

      expect(shadowAll(el, ACTIVE_BUTTON)).toHaveLength(1)
      expect(activePanels(el)).toEqual(['Errors'])
    })

    it('opens the tab named by an open-dock-tab request', async () => {
      const el = await mountTabs(DOCK)

      openTab('Errors')
      await settle(el)

      expect(text(shadow(el, ACTIVE_BUTTON))).toContain('Errors')
      expect(activePanels(el)).toEqual(['Errors'])
    })

    it('ignores an open-dock-tab request for a label it does not own', async () => {
      const el = await mountTabs(DOCK)

      openTab('A11y')
      await settle(el)

      expect(activePanels(el)).toEqual(['Source'])
    })

    it('ignores an open-dock-tab request carrying no label', async () => {
      const el = await mountTabs(DOCK)

      openTab()
      await settle(el)

      expect(activePanels(el)).toEqual(['Source'])
    })

    it('stops answering open-dock-tab once it leaves the page', async () => {
      const el = await mountTabs(DOCK)
      el.remove()

      openTab('Errors')

      expect(activePanels(el)).toEqual(['Source'])
    })
  })

  describe('count badges', () => {
    it("shows each tab's count next to its label", async () => {
      const el = await mountTabs(DOCK)

      // Derived from the same specs the children were built from, so a bar that
      // badged the wrong tab — or dropped the filter — fails here.
      expect(texts(el, BADGE)).toEqual(
        DOCK.filter((tab) => tab.badge).map((tab) => String(tab.badge))
      )
      expect(texts(el, BADGE)).toEqual(['4', '2'])
    })

    it('leaves a tab without a count unbadged', async () => {
      // The workbench leaves `.badge` off Source/Log/A11y entirely.
      const el = await mountTabs([{ label: 'Source' }])

      expect(panels(el)[0].badge).toBe(undefined)
      expect(shadowAll(el, BADGE)).toHaveLength(0)
    })

    it('leaves a tab counting zero unbadged', async () => {
      // `.badge="${this.consoleLogs?.length || 0}"` — an empty panel really does
      // report 0 rather than leaving the count off.
      const el = await mountTabs([{ label: 'Console', badge: 0 }])

      expect(shadowAll(el, BADGE)).toHaveLength(0)
    })

    it('badges a count written as an attribute as well', async () => {
      // Only `badgeTone` arrives as an attribute today, but the count survives
      // Lit's converter either way — see tab.test.ts for that conversion.
      const el = await mountTabs([{ label: 'Console' }])

      panels(el)[0].setAttribute('badge', '9')
      await nextBadgePoll(el)

      expect(texts(el, BADGE)).toEqual(['9'])
    })

    it('tints the count of a danger tab', async () => {
      const el = await mountTabs(DOCK)

      expect(
        shadow(el, `${BADGE}--danger`)?.previousElementSibling?.textContent
      ).toBe('Errors')
      expect(shadowAll(el, `${BADGE}--danger`)).toHaveLength(1)
    })

    it('picks up a count that changes after the strip rendered', async () => {
      const el = await mountTabs([{ label: 'Console', badge: 0 }])

      panels(el)[0].badge = 7
      await nextBadgePoll(el)

      expect(texts(el, BADGE)).toEqual(['7'])
    })
  })

  describe('remembering the open tab', () => {
    it('remembers the tab opened under its cache id', async () => {
      const el = await mountTabs(DOCK, { cacheId: CACHE_ID })

      tabButton(el, 'Console').click()

      expect(localStorage.getItem(CACHE_ID)).toBe('Console')
    })

    it('reopens the remembered tab on the next mount', async () => {
      localStorage.setItem(CACHE_ID, 'Errors')

      const el = await mountTabs(DOCK, { cacheId: CACHE_ID })

      expect(activePanels(el)).toEqual(['Errors'])
    })

    it('prefers the remembered tab over the child that claims to be active', async () => {
      localStorage.setItem(CACHE_ID, 'Console')

      const el = await mountTabs(
        [{ label: 'Source', active: true }, { label: 'Console' }],
        { cacheId: CACHE_ID }
      )

      expect(activePanels(el)).toEqual(['Console'])
    })

    it('remembers nothing without a cache id', async () => {
      const el = await mountTabs(DOCK)

      tabButton(el, 'Console').click()

      expect(localStorage.getItem(CACHE_ID)).toBe(null)
    })
  })
})
