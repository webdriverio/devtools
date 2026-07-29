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

interface TabMarkup {
  label: string
  badge?: number
  badgeTone?: string
  active?: boolean
}

/** The light-DOM children of one tabs bar: it reads each child's `label`
 *  attribute and badge properties, so this markup is the whole input. */
function tabsMarkup(...tabs: TabMarkup[]): string {
  return tabs
    .map(
      ({ label, badge, badgeTone, active }) =>
        `<wdio-devtools-tab label="${label}"` +
        (badge === undefined ? '' : ` badge="${badge}"`) +
        (badgeTone === undefined ? '' : ` badgeTone="${badgeTone}"`) +
        (active ? ' active' : '') +
        `><p>${label} panel</p></wdio-devtools-tab>`
    )
    .join('')
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The bar builds its tab list in a `setTimeout` from `connectedCallback` — it
 *  waits for its light DOM to be parsed — so the nav only exists a macrotask
 *  after the mount resolves. */
async function mountTabs(
  markup: string,
  props: Record<string, unknown> = {}
): Promise<DevtoolsTabs> {
  const el = await mount<DevtoolsTabs>(TAG, { innerHTML: markup, ...props })
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

const DOCK = tabsMarkup(
  { label: 'Source' },
  { label: 'Console', badge: 4 },
  { label: 'Errors', badge: 2, badgeTone: 'danger' }
)

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
      const el = await mountTabs(
        tabsMarkup({ label: 'Source' }, { label: 'Console', active: true })
      )

      expect(text(shadow(el, ACTIVE_BUTTON))).toContain('Console')
      expect(activePanels(el)).toEqual(['Console'])
    })

    it('renders a single tab as the active one', async () => {
      const el = await mountTabs(tabsMarkup({ label: 'Source' }))

      expect(shadowAll(el, TAB_BUTTON)).toHaveLength(1)
      expect(activePanels(el)).toEqual(['Source'])
    })

    it('renders no strip at all without any tabs', async () => {
      const el = await mountTabs('')

      expect(shadowAll(el, NAV)).toHaveLength(0)
      expect(shadowAll(el, TAB_BUTTON)).toHaveLength(0)
    })

    it('keeps a slotted action out of the tab list', async () => {
      const el = await mountTabs(
        `${tabsMarkup({ label: 'Source' })}<nav slot="actions"><button>collapse</button></nav>`
      )

      expect(texts(el, TAB_LABEL)).toEqual(['Source'])
    })

    it('adds a button for a tab that mounts after the strip', async () => {
      const el = await mountTabs(tabsMarkup({ label: 'Source' }))

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

      expect(texts(el, BADGE)).toEqual(['4', '2'])
    })

    it('leaves a tab without a count unbadged', async () => {
      const el = await mountTabs(tabsMarkup({ label: 'Source' }))

      expect(shadowAll(el, BADGE)).toHaveLength(0)
    })

    it('leaves a tab counting zero unbadged', async () => {
      const el = await mountTabs(tabsMarkup({ label: 'Console', badge: 0 }))

      expect(shadowAll(el, BADGE)).toHaveLength(0)
    })

    it('tints the count of a danger tab', async () => {
      const el = await mountTabs(DOCK)

      expect(
        shadow(el, `${BADGE}--danger`)?.previousElementSibling?.textContent
      ).toBe('Errors')
      expect(shadowAll(el, `${BADGE}--danger`)).toHaveLength(1)
    })

    it('picks up a count that changes after the strip rendered', async () => {
      const el = await mountTabs(tabsMarkup({ label: 'Console', badge: 0 }))

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
        tabsMarkup({ label: 'Source', active: true }, { label: 'Console' }),
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
