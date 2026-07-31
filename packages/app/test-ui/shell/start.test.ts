import '@components/onboarding/start.js'
import type { DevtoolsStart } from '@components/onboarding/start.js'

import { mount } from '../support/mount.js'
import { shadow, shadowAll, text, texts } from '../support/queries.js'

const START = 'wdio-devtools-start'
const HERO = 'img'
const INSTALL_SNIPPET = 'pre'
const CONFIG_SNIPPET = 'pre.w-full'
const COPY_COLUMN = 'section'
/** The block that carries a setup step's vertical spacing. */
const STEP = 'section > .py-4'

/** The service snippet as the onboarding screen prints it. Restated because
 *  `CONFIG_CODE_EXAMPLE` is module-private — this is the copy a first-time user
 *  copy-pastes, so the exact text is the contract. */
const CONFIG_CODE_EXAMPLE = `export const config = {
  // ...
  services: ['devtools'],
  // ...
}`

const mountStart = () => mount<DevtoolsStart>(START)

/** Tag names of the copy column's direct children — what the PARSER made of the
 *  markup, which is what the reader sees. Illegal nesting (a `<p>` holding an
 *  `<h3>` or a `<pre>`) never shows up as a template error: the parser closes
 *  the `<p>` early and re-parents the rest, so only the DOM can tell. */
const outline = (start: DevtoolsStart): string[] =>
  Array.from(shadow(start, COPY_COLUMN)?.children ?? []).map((el) =>
    el.tagName.toLowerCase()
  )

/** Copy the column holds directly, outside any element of its own. */
const looseCopy = (start: DevtoolsStart): string[] =>
  Array.from(shadow(start, COPY_COLUMN)?.childNodes ?? [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((value) => value !== '')

describe('wdio-devtools-start', () => {
  describe('onboarding copy', () => {
    it('names the product as its heading', async () => {
      const start = await mountStart()

      expect(text(shadow(start, 'h2'))).toBe('WebdriverIO Devtools')
    })

    it('renders the hero image the backend serves at /robot.png', async () => {
      const start = await mountStart()

      const hero = shadow<HTMLImageElement>(start, HERO)
      expect(hero?.getAttribute('src')).toBe('/robot.png')
      expect(hero?.getAttribute('width')).toBe('200px')
    })

    it('titles the single setup section', async () => {
      const start = await mountStart()

      expect(texts(start, 'h3')).toEqual(['Embed into Project'])
    })

    it('prints the install command and the service snippet, in that order', async () => {
      const start = await mountStart()

      const snippets = shadowAll(start, INSTALL_SNIPPET)
      expect(snippets.map((pre) => pre.textContent)).toEqual([
        'npm install @wdio/devtools',
        CONFIG_CODE_EXAMPLE
      ])
    })

    it('keeps the service snippet verbatim, newlines included', async () => {
      const start = await mountStart()

      expect(shadow(start, CONFIG_SNIPPET)?.textContent).toBe(
        CONFIG_CODE_EXAMPLE
      )
      expect(shadow(start, CONFIG_SNIPPET)?.textContent).toContain(
        "services: ['devtools']"
      )
    })

    it('walks the reader from installing to registering the service', async () => {
      const start = await mountStart()

      const copy = text(shadow(start, COPY_COLUMN))
      expect(copy).toContain('First install WebdriverIO Devtools via:')
      expect(copy).toContain('Then add it as a service:')
      expect(copy.indexOf('First install')).toBeLessThan(
        copy.indexOf('Then add it as a service')
      )
    })
  })

  describe('markup', () => {
    it('lays the column out as the product name plus one block per setup step', async () => {
      const start = await mountStart()

      expect(outline(start)).toEqual(['h2', 'div', 'div'])
    })

    it('keeps each step whole inside the block that spaces it', async () => {
      const start = await mountStart()

      const steps = shadowAll(start, STEP)
      expect(steps).toHaveLength(2)
      // Spacing on a block that holds nothing spaces nothing, so the step's
      // heading, prose and snippet all have to sit inside it.
      expect(text(steps[0])).toBe(
        'Embed into Project First install WebdriverIO Devtools via: npm install @wdio/devtools'
      )
      expect(text(steps[1])).toContain('Then add it as a service:')
      expect(steps[1].querySelector('pre')?.textContent).toBe(
        CONFIG_CODE_EXAMPLE
      )
    })

    it('nests the heading and the snippets legally, so none is re-parented', async () => {
      const start = await mountStart()

      // A `<p>` takes phrasing content only. `<h3>`/`<pre>` inside one closes it
      // and leaves both as siblings of the column — the shapes asserted against.
      expect(shadowAll(start, 'p h3, p pre')).toHaveLength(0)
      expect(
        shadowAll(start, `${COPY_COLUMN} > h3, ${COPY_COLUMN} > pre`)
      ).toHaveLength(0)
      expect(shadowAll(start, `${STEP} > h3`)).toHaveLength(1)
      expect(shadowAll(start, `${STEP} > pre`)).toHaveLength(2)
    })

    it('carries every line of prose in a paragraph of its own', async () => {
      const start = await mountStart()

      expect(looseCopy(start)).toEqual([])
      expect(texts(start, 'p')).toEqual([
        'First install WebdriverIO Devtools via:',
        'Then add it as a service:'
      ])
    })
  })

  describe('interaction', () => {
    it('offers no control to click — the screen is copy only', async () => {
      const start = await mountStart()

      expect(
        shadowAll(start, 'button, a, input, [role="button"]')
      ).toHaveLength(0)
    })

    it('dispatches nothing while it is on screen', async () => {
      const events: Event[] = []
      const record = (event: Event) => events.push(event)
      const types = ['click', 'app-logs', 'clear-execution-data']
      types.forEach((type) => window.addEventListener(type, record))

      const start = await mountStart()
      shadow(start, 'section')?.dispatchEvent(new Event('mouseover'))

      types.forEach((type) => window.removeEventListener(type, record))
      expect(events).toHaveLength(0)
    })
  })
})
