import '@components/tabs.js'
import type { DevtoolsTab } from '@components/tabs.js'

import { mount, settle } from '../../support/mount.js'
import { shadowAll } from '../../support/queries.js'

const TAG = 'wdio-devtools-tab'

const slotted = (el: DevtoolsTab) =>
  el.shadowRoot?.querySelector<HTMLSlotElement>('slot')?.assignedElements() ??
  []

const display = (el: DevtoolsTab) => getComputedStyle(el).display

describe('wdio-devtools-tab', () => {
  describe('its panel', () => {
    it('projects the panel it wraps', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p id="panel">Console panel</p>'
      })

      expect(slotted(el).map((child) => child.id)).toEqual(['panel'])
    })

    it('renders nothing of its own but the slot', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p>Console panel</p>'
      })

      expect(shadowAll(el, '*').map((child) => child.tagName)).toEqual(['SLOT'])
    })

    it('stays hidden while another tab is open', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p>Console panel</p>'
      })

      expect(el.hasAttribute('active')).toBe(false)
      expect(display(el)).toBe('none')
    })

    it('shows its panel once the tabs bar marks it active', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p>Console panel</p>'
      })

      el.setAttribute('active', '')
      await settle(el)

      expect(display(el)).toBe('flex')
    })

    it('hides its panel again when the bar moves on', async () => {
      // Opened the way the bar opens it — `setAttribute`, since visibility comes
      // from `:host([active])` and the element declares no `active` property, so
      // a mount-time `{ active: '' }` would only set an expando and leave the
      // panel hidden before the removal under test.
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p>Console panel</p>'
      })
      el.setAttribute('active', '')
      await settle(el)
      expect(display(el)).toBe('flex')

      el.removeAttribute('active')
      await settle(el)

      expect(display(el)).toBe('none')
    })

    it('projects nothing when it wraps no panel', async () => {
      const el = await mount<DevtoolsTab>(TAG)

      expect(slotted(el)).toEqual([])
    })
  })

  describe('the count it reports to the bar', () => {
    it('carries no count until one is set', async () => {
      const el = await mount<DevtoolsTab>(TAG)

      expect(el.badge).toBe(undefined)
      expect(el.badgeTone).toBe(undefined)
    })

    // The workbench binds the count as a PROPERTY (`.badge="${…}"`) and the tone
    // as an attribute (`badgeTone="danger"`); the bar reads both as properties,
    // so the attribute has to reach the typed property to be badged at all.
    it('reads a count written as an attribute as a number', async () => {
      const el = await mount<DevtoolsTab>(TAG)

      el.setAttribute('badge', '12')
      await settle(el)

      expect(el.badge).toBe(12)
    })

    it('reads the danger tone written as an attribute', async () => {
      const el = await mount<DevtoolsTab>(TAG)

      el.setAttribute('badgeTone', 'danger')
      await settle(el)

      expect(el.badgeTone).toBe('danger')
    })

    it('draws no badge of its own — the bar renders the count', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        badge: 12,
        badgeTone: 'danger',
        innerHTML: '<p>Console panel</p>'
      })

      expect(shadowAll(el, 'span')).toHaveLength(0)
      expect(el.shadowRoot?.textContent?.trim()).toBe('')
    })

    it('keeps its label as data for the bar rather than rendering it', async () => {
      const el = await mount<DevtoolsTab>(TAG, {
        innerHTML: '<p id="panel">Console panel</p>'
      })

      el.setAttribute('label', 'Console')
      await settle(el)

      // The bar draws the label (see tabs.test.ts); a tab that drew it too would
      // print it twice. So the label must change nothing about what this element
      // renders — still the bare slot — while the panel keeps being projected.
      expect(shadowAll(el, '*').map((child) => child.tagName)).toEqual(['SLOT'])
      expect(el.shadowRoot?.textContent?.trim()).toBe('')
      expect(slotted(el).map((child) => child.id)).toEqual(['panel'])
    })
  })
})
