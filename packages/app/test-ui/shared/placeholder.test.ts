import '@components/placeholder.js'
import type { DevtoolsPlaceholder } from '@components/placeholder.js'

import { mount, settle } from '../support/mount.js'
import { shadow, shadowAll, text } from '../support/queries.js'

const COMPONENT = 'wdio-devtools-placeholder'
const SKELETON = '.ph-item'
const SKELETON_ROW = '.ph-item .ph-row'
const EMPTY_STATE = '.empty-state'
const EMPTY_STATE_BLOCK = '.empty-state > div'
const EMPTY_ICON = '.empty-state-icon'
const EMPTY_HEADING = '.empty-state-text'
const EMPTY_DETAIL = '.empty-state-detail'

/** A real caller's copy — the a11y panel's unavailable state. */
const GLYPH = '🌳'
const HEADING = 'No accessibility snapshot for this command'
const DETAIL =
  'Per-command accessibility capture is WebdriverIO-only — Selenium and Nightwatch traces do not include it.'

const mountPlaceholder = (props?: Record<string, unknown>) =>
  mount<DevtoolsPlaceholder>(COMPONENT, props)

/** Copy set the way a panel sets it: static attributes in a lit template, which
 *  only reach the render when the component declares the properties behind
 *  them. Mounting through properties alone would pass either way. */
async function mountWithAttributes(
  attributes: Record<string, string>
): Promise<DevtoolsPlaceholder> {
  const el = await mountPlaceholder()
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value)
  }
  await settle(el)
  return el
}

const blockClasses = (el: DevtoolsPlaceholder) =>
  shadowAll(el, EMPTY_STATE_BLOCK).map((block) => block.className)

describe('wdio-devtools-placeholder', () => {
  describe('loading skeleton', () => {
    it('draws the skeleton when it is given no copy', async () => {
      const el = await mountPlaceholder()

      expect(shadowAll(el, SKELETON)).toHaveLength(1)
      expect(shadowAll(el, EMPTY_STATE)).toHaveLength(0)
    })

    it('draws skeleton rows rather than any text', async () => {
      const el = await mountPlaceholder()

      expect(shadowAll(el, SKELETON_ROW)).toHaveLength(1)
      expect(text(shadow(el, SKELETON))).toBe('')
    })

    // A glyph says nothing about why the panel is empty, so it is not on its own
    // a reason to stop waiting.
    it('keeps the skeleton when only a glyph is given', async () => {
      const el = await mountPlaceholder({ icon: GLYPH })

      expect(shadowAll(el, SKELETON)).toHaveLength(1)
      expect(shadowAll(el, EMPTY_STATE)).toHaveLength(0)
      expect(shadowAll(el, EMPTY_ICON)).toHaveLength(0)
    })
  })

  describe('empty state', () => {
    it('renders the copy it is given', async () => {
      const el = await mountPlaceholder({
        icon: GLYPH,
        heading: HEADING,
        description: DETAIL
      })

      expect(text(shadow(el, EMPTY_ICON))).toBe(GLYPH)
      expect(text(shadow(el, EMPTY_HEADING))).toBe(HEADING)
      expect(text(shadow(el, EMPTY_DETAIL))).toBe(DETAIL)
    })

    // The regression test for inert copy: the component declared no properties,
    // so every panel's attributes were dropped and all of them drew skeletons.
    it('renders the copy a panel sets as attributes', async () => {
      const el = await mountWithAttributes({
        icon: GLYPH,
        heading: HEADING,
        description: DETAIL
      })

      expect(text(shadow(el, EMPTY_HEADING))).toBe(HEADING)
      expect(text(shadow(el, EMPTY_DETAIL))).toBe(DETAIL)
      expect(text(shadow(el, EMPTY_ICON))).toBe(GLYPH)
    })

    it('draws no skeleton once it has copy', async () => {
      const el = await mountPlaceholder({ heading: HEADING })

      expect(shadowAll(el, EMPTY_STATE)).toHaveLength(1)
      expect(shadowAll(el, SKELETON)).toHaveLength(0)
      expect(shadowAll(el, SKELETON_ROW)).toHaveLength(0)
    })

    it('renders the glyph, heading and description in that order', async () => {
      const el = await mountPlaceholder({
        icon: GLYPH,
        heading: HEADING,
        description: DETAIL
      })

      expect(blockClasses(el)).toEqual([
        'empty-state-icon',
        'empty-state-text',
        'empty-state-detail'
      ])
    })

    it('keeps the copy out of the host tooltip', async () => {
      const el = await mountPlaceholder({
        heading: HEADING,
        description: DETAIL
      })

      expect(el.getAttribute('title')).toBe(null)
    })
  })

  describe('partial copy', () => {
    it('renders an empty state from a heading alone', async () => {
      const el = await mountPlaceholder({ heading: HEADING })

      expect(text(shadow(el, EMPTY_HEADING))).toBe(HEADING)
      expect(shadowAll(el, EMPTY_DETAIL)).toHaveLength(0)
      expect(blockClasses(el)).toEqual(['empty-state-text'])
    })

    it('renders an empty state from a description alone', async () => {
      const el = await mountPlaceholder({ description: DETAIL })

      expect(text(shadow(el, EMPTY_DETAIL))).toBe(DETAIL)
      expect(shadowAll(el, EMPTY_HEADING)).toHaveLength(0)
      expect(blockClasses(el)).toEqual(['empty-state-detail'])
    })

    it('leaves out the glyph when none was given', async () => {
      const el = await mountPlaceholder({
        heading: HEADING,
        description: DETAIL
      })

      expect(shadowAll(el, EMPTY_ICON)).toHaveLength(0)
      expect(blockClasses(el)).toEqual([
        'empty-state-text',
        'empty-state-detail'
      ])
    })
  })

  describe('switching modes', () => {
    it('swaps the skeleton for the empty state when copy arrives', async () => {
      const el = await mountPlaceholder()
      expect(shadowAll(el, SKELETON)).toHaveLength(1)

      el.heading = HEADING
      await settle(el)

      expect(shadowAll(el, SKELETON)).toHaveLength(0)
      expect(text(shadow(el, EMPTY_HEADING))).toBe(HEADING)
    })

    it('falls back to the skeleton when the copy is taken away', async () => {
      const el = await mountWithAttributes({ heading: HEADING })
      expect(shadowAll(el, EMPTY_STATE)).toHaveLength(1)

      el.removeAttribute('heading')
      await settle(el)

      expect(shadowAll(el, SKELETON)).toHaveLength(1)
      expect(shadowAll(el, EMPTY_STATE)).toHaveLength(0)
    })
  })
})
