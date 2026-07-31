import type { Metadata, MetadataBySession } from '@wdio/devtools-shared'

import {
  metadataBySessionContext,
  metadataContext
} from '@/controller/context.js'
import { PENDING_SESSION_KEY } from '@/controller/contextUpdates.js'
import '@components/workbench/metadata.js'
import type { DevtoolsMetadata } from '@components/workbench/metadata.js'

import { mount, mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  LOGIN_URL,
  SECURE_URL,
  SPEC_FILE,
  loginMetadata,
  metadata,
  secureMetadata
} from './fixtures.js'

const PANEL = 'wdio-devtools-metadata'
const SECTION = '.meta-sec'
const HEADING = '.meta-sec h4'
const CHEVRON = '.chev'
const OPEN_CHEVRON = '.chev.open'
const CARD = '.meta-card'
const ROW = '.mrow'
const JSON_BLOCK = '.mrow.json pre'
const LINK = '.mrow .v a'
const BOOL_TRUE = '.bool-true'
const BOOL_FALSE = '.bool-false'
const SELECT = '.session-select'
const OPTION = '.session-select option'
const PLACEHOLDER = 'wdio-devtools-placeholder'

interface MetaSection {
  label: string
  keys: string[]
  /** Row values, reading the JSON block of an object row and the plain value
   *  cell of every other. */
  values: string[]
}

async function mountMetadata(
  active: Metadata | undefined,
  bySession: MetadataBySession = {}
): Promise<DevtoolsMetadata> {
  const panel = await mountWithContext<DevtoolsMetadata>(PANEL, [
    { context: metadataContext, value: active },
    { context: metadataBySessionContext, value: bySession }
  ])
  await settle(panel)
  return panel
}

const sections = (panel: DevtoolsMetadata): MetaSection[] =>
  shadowAll(panel, SECTION).map((section) => ({
    label: text(shadow(section, 'h4')),
    keys: texts(section, `${ROW} .k`),
    values: shadowAll(section, ROW).map((row) =>
      text(shadow(row, '.v') ?? shadow(row, 'pre'))
    )
  }))

const sectionLabels = (panel: DevtoolsMetadata) =>
  sections(panel).map((section) => section.label)

function sectionNamed(panel: DevtoolsMetadata, label: string): MetaSection {
  const found = sections(panel).find((section) => section.label === label)
  if (!found) {
    throw new Error(`no metadata section headed "${label}"`)
  }
  return found
}

/** Raw lines of a JSON block — `text()` collapses the indentation that makes it
 *  pretty-printed in the first place. */
const jsonLines = (el: Element | null): string[] =>
  (el?.textContent ?? '').trim().split('\n')

/** A captured value as the panel prints it in a JSON block. */
const prettyJson = (value: unknown) => JSON.stringify(value, null, 2)

/** A session option's label — `Session <n>` plus the host of the page it was
 *  last on, which is what makes several options distinguishable. */
const sessionLabel = (index: number, url?: string) => {
  const host = url ? tryHost(url) : undefined
  return host ? `Session ${index + 1} · ${host}` : `Session ${index + 1}`
}

const tryHost = (url: string): string | undefined => {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

async function toggleSection(panel: DevtoolsMetadata, label: string) {
  const heading = shadowAll(panel, HEADING).find(
    (candidate) => text(candidate) === label
  )
  if (!heading) {
    throw new Error(`no metadata section headed "${label}"`)
  }
  heading.click()
  await settle(panel)
}

async function pickSession(panel: DevtoolsMetadata, sessionKey: string) {
  const select = shadow<HTMLSelectElement>(panel, SELECT)
  if (!select) {
    throw new Error('the metadata panel rendered no session picker')
  }
  select.value = sessionKey
  select.dispatchEvent(new Event('change'))
  await settle(panel)
}

describe('wdio-devtools-metadata', () => {
  describe('session section', () => {
    it('renders a labelled row per session field the capture carried', async () => {
      const panel = await mountMetadata(loginMetadata)

      expect(sectionNamed(panel, 'Session')).toEqual({
        label: 'Session',
        keys: [
          'Session ID',
          'Environment',
          'WebDriver Host',
          'Test File',
          'URL',
          'Viewport'
        ],
        // Derived, so a row wired to the wrong metadata field fails.
        values: [
          loginMetadata.sessionId,
          loginMetadata.testEnv,
          loginMetadata.host,
          loginMetadata.modulePath,
          loginMetadata.url,
          `${loginMetadata.viewport?.width} × ${loginMetadata.viewport?.height} px`
        ]
      })
      expect(sectionNamed(panel, 'Session').values).toEqual([
        '3a7f19c4e2b8',
        'local',
        'http://localhost:4444',
        SPEC_FILE,
        LOGIN_URL,
        '1600 × 900 px'
      ])
    })

    it('renders the captured viewport as one row of dimensions', async () => {
      const viewport = {
        width: 1024,
        height: 768,
        offsetLeft: 40,
        offsetTop: 90,
        scale: 2
      }
      const panel = await mountMetadata(metadata({ viewport }))

      const session = sectionNamed(panel, 'Session')
      expect(session.keys).toEqual(['Viewport'])
      // Derived from the fixture, so a row that drops a dimension, swaps the two
      // or reads the scroll offsets / pinch scale instead fails.
      expect(session.values).toEqual([
        `${viewport.width} × ${viewport.height} px`
      ])
      expect(session.values).toEqual(['1024 × 768 px'])
    })

    it('leaves out the session fields the capture did not carry', async () => {
      const panel = await mountMetadata(metadata({ sessionId: 'only-an-id' }))

      expect(sectionNamed(panel, 'Session').keys).toEqual(['Session ID'])
    })

    it('renders no Session section when none of its fields were captured', async () => {
      const panel = await mountMetadata(
        metadata({ capabilities: { browserName: 'chrome' } })
      )

      expect(sectionLabels(panel)).toEqual(['Capabilities'])
    })

    it('links every http value out to the page it points at', async () => {
      const panel = await mountMetadata(loginMetadata)

      const links = shadowAll<HTMLAnchorElement>(panel, LINK)
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        'http://localhost:4444',
        LOGIN_URL
      ])
      expect(links[1].getAttribute('target')).toBe('_blank')
      expect(links[1].getAttribute('rel')).toBe('noreferrer')
    })
  })

  describe('capability and option rows', () => {
    it('renders each captured section in a fixed order', async () => {
      const panel = await mountMetadata(loginMetadata)

      expect(sectionLabels(panel)).toEqual([
        'Session',
        'Capabilities',
        'Desired Capabilities',
        'Options'
      ])
    })

    it('renders a row per capability', async () => {
      const panel = await mountMetadata(loginMetadata)

      const captured = loginMetadata.capabilities as Record<string, unknown>
      const capabilities = sectionNamed(panel, 'Capabilities')
      // One row per captured capability, in capture order.
      expect(capabilities.keys).toEqual(Object.keys(captured))
      expect(capabilities.keys).toEqual([
        'browserName',
        'browserVersion',
        'goog:chromeOptions',
        'setWindowRect'
      ])
      // Object values go through a JSON block, scalars through the value cell.
      expect(capabilities.values).toEqual([
        String(captured.browserName),
        String(captured.browserVersion),
        prettyJson(captured['goog:chromeOptions']).replace(/\s+/g, ' '),
        String(captured.setWindowRect)
      ])
      expect(capabilities.values).toEqual([
        'chrome',
        '149.0.7204.15',
        '{ "args": [ "--headless=new" ] }',
        'true'
      ])
    })

    it('renders a row per runner option', async () => {
      const panel = await mountMetadata(loginMetadata)

      const captured = loginMetadata.options as Record<string, unknown>
      expect(sectionNamed(panel, 'Options')).toEqual({
        label: 'Options',
        keys: Object.keys(captured),
        values: Object.values(captured).map(String)
      })
      expect(sectionNamed(panel, 'Options')).toEqual({
        label: 'Options',
        keys: ['waitforTimeout', 'logLevel'],
        values: ['5000', 'error']
      })
    })

    it('renders a row per requested capability', async () => {
      const panel = await mountMetadata(loginMetadata)

      const captured = loginMetadata.desiredCapabilities as Record<
        string,
        unknown
      >
      expect(sectionNamed(panel, 'Desired Capabilities')).toEqual({
        label: 'Desired Capabilities',
        keys: Object.keys(captured),
        values: Object.values(captured).map(String)
      })
      expect(sectionNamed(panel, 'Desired Capabilities')).toEqual({
        label: 'Desired Capabilities',
        keys: ['browserName', 'acceptInsecureCerts'],
        values: ['chrome', 'false']
      })
    })

    it('omits a section whose bag was captured empty', async () => {
      const panel = await mountMetadata(
        metadata({ sessionId: 'no-caps', capabilities: {}, options: {} })
      )

      expect(sectionLabels(panel)).toEqual(['Session'])
    })

    it('omits a section the capture left out entirely', async () => {
      const panel = await mountMetadata(
        metadata({
          sessionId: 'caps-only',
          capabilities: { platformName: 'mac' }
        })
      )

      expect(sectionLabels(panel)).toEqual(['Session', 'Capabilities'])
    })

    it('colours a boolean capability by its value', async () => {
      const panel = await mountMetadata(loginMetadata)

      expect(text(shadow(panel, BOOL_TRUE))).toBe('true')
      expect(text(shadow(panel, BOOL_FALSE))).toBe('false')
    })

    it('pretty-prints an object capability into a JSON block', async () => {
      const panel = await mountMetadata(loginMetadata)

      expect(jsonLines(shadow(panel, JSON_BLOCK))).toEqual(
        prettyJson(
          (loginMetadata.capabilities as Record<string, unknown>)[
            'goog:chromeOptions'
          ]
        ).split('\n')
      )
      expect(jsonLines(shadow(panel, JSON_BLOCK))).toEqual([
        '{',
        '  "args": [',
        '    "--headless=new"',
        '  ]',
        '}'
      ])
    })

    it('renders an array option as a JSON block too', async () => {
      const specs = ['login.e2e.ts']
      const panel = await mountMetadata(metadata({ options: { specs } }))

      expect(shadowAll(panel, JSON_BLOCK)).toHaveLength(1)
      expect(jsonLines(shadow(panel, JSON_BLOCK))).toEqual(
        prettyJson(specs).split('\n')
      )
      expect(jsonLines(shadow(panel, JSON_BLOCK))).toEqual([
        '[',
        '  "login.e2e.ts"',
        ']'
      ])
    })

    it('renders a null option as text rather than a JSON block', async () => {
      const panel = await mountMetadata(
        metadata({ options: { outputDir: null } })
      )

      expect(shadowAll(panel, JSON_BLOCK)).toHaveLength(0)
      expect(sectionNamed(panel, 'Options').values).toEqual(['null'])
    })
  })

  describe('collapsing', () => {
    it('starts with every section expanded', async () => {
      const panel = await mountMetadata(loginMetadata)

      expect(shadowAll(panel, OPEN_CHEVRON)).toHaveLength(4)
      expect(shadowAll(panel, CARD)).toHaveLength(4)
    })

    it('hides a section body when its heading is clicked', async () => {
      const panel = await mountMetadata(loginMetadata)
      await toggleSection(panel, 'Capabilities')

      expect(shadowAll(panel, CARD)).toHaveLength(3)
      expect(sectionNamed(panel, 'Capabilities').keys).toEqual([])
    })

    it('turns the chevron of a collapsed section closed', async () => {
      const panel = await mountMetadata(loginMetadata)
      await toggleSection(panel, 'Capabilities')

      expect(shadowAll(panel, CHEVRON)).toHaveLength(4)
      expect(shadowAll(panel, OPEN_CHEVRON)).toHaveLength(3)
    })

    it('collapses only the section whose heading was clicked', async () => {
      const panel = await mountMetadata(loginMetadata)
      await toggleSection(panel, 'Session')

      expect(sectionNamed(panel, 'Session').keys).toEqual([])
      expect(sectionNamed(panel, 'Options').keys).toEqual([
        'waitforTimeout',
        'logLevel'
      ])
    })

    it('expands a collapsed section when its heading is clicked again', async () => {
      const panel = await mountMetadata(loginMetadata)
      await toggleSection(panel, 'Options')
      await toggleSection(panel, 'Options')

      expect(shadowAll(panel, CARD)).toHaveLength(4)
      expect(sectionNamed(panel, 'Options').values).toEqual(['5000', 'error'])
    })
  })

  describe('several sessions', () => {
    it('renders no session picker for a single captured session', async () => {
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata
      })

      expect(shadowAll(panel, SELECT)).toHaveLength(0)
      expect(sectionNamed(panel, 'Session').values).toContain(
        loginMetadata.sessionId
      )
    })

    it('renders one picker option per captured session', async () => {
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': secureMetadata
      })

      expect(shadowAll(panel, OPTION)).toHaveLength(2)
    })

    it('labels each option by its position and the host it opened', async () => {
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': secureMetadata
      })

      expect(texts(panel, OPTION)).toEqual([
        sessionLabel(0, loginMetadata.url),
        sessionLabel(1, secureMetadata.url)
      ])
      expect(texts(panel, OPTION)).toEqual([
        'Session 1 · the-internet.herokuapp.com',
        'Session 2 · the-internet.herokuapp.com'
      ])
    })

    it('labels a session that never navigated by its position alone', async () => {
      const never = metadata({ sessionId: 'never-navigated' })
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': never
      })

      expect(texts(panel, OPTION)).toEqual([
        sessionLabel(0, loginMetadata.url),
        sessionLabel(1, never.url)
      ])
      expect(texts(panel, OPTION)).toEqual([
        'Session 1 · the-internet.herokuapp.com',
        'Session 2'
      ])
    })

    it('labels a session whose url is not a url by its position alone', async () => {
      // `about:blank` parses as a URL but has no host, so the suffix drops.
      const blank = metadata({ url: 'about:blank' })
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': blank
      })

      expect(texts(panel, OPTION)).toEqual([
        sessionLabel(0, loginMetadata.url),
        sessionLabel(1, blank.url)
      ])
      expect(texts(panel, OPTION)).toEqual([
        'Session 1 · the-internet.herokuapp.com',
        'Session 2'
      ])
    })

    it('shows the newest session before one is picked', async () => {
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': secureMetadata
      })

      expect(sectionNamed(panel, 'Session').values).toEqual([
        secureMetadata.sessionId,
        secureMetadata.url
      ])
      expect(sectionNamed(panel, 'Session').values).toEqual([
        'b52d08fa17c6',
        SECURE_URL
      ])
      expect(shadow<HTMLSelectElement>(panel, SELECT)?.value).toBe('session-2')
    })

    it('shows the session the picker selects', async () => {
      const panel = await mountMetadata(undefined, {
        'session-1': loginMetadata,
        'session-2': secureMetadata
      })
      await pickSession(panel, 'session-1')

      expect(sectionNamed(panel, 'Session').values).toContain(
        loginMetadata.sessionId
      )
      expect(sectionNamed(panel, 'Capabilities').values).toContain('chrome')
    })

    it('keeps the pending-session buffer out of the picker', async () => {
      const panel = await mountMetadata(undefined, {
        [PENDING_SESSION_KEY]: metadata({ testEnv: 'buffered' }),
        'session-1': loginMetadata,
        'session-2': secureMetadata
      })

      expect(shadowAll(panel, OPTION)).toHaveLength(2)
      // Numbered over the *filtered* list, so the buffer doesn't shift the
      // positions by one.
      expect(texts(panel, OPTION)).toEqual([
        sessionLabel(0, loginMetadata.url),
        sessionLabel(1, secureMetadata.url)
      ])
      expect(texts(panel, OPTION)).toEqual([
        'Session 1 · the-internet.herokuapp.com',
        'Session 2 · the-internet.herokuapp.com'
      ])
    })

    it('falls back to the active metadata when no session map was captured', async () => {
      const panel = await mountMetadata(loginMetadata, {})

      expect(sectionNamed(panel, 'Session').values).toContain(
        loginMetadata.sessionId
      )
      expect(shadowAll(panel, SELECT)).toHaveLength(0)
    })

    it('prefers the captured session over the active metadata', async () => {
      const panel = await mountMetadata(loginMetadata, {
        'session-2': secureMetadata
      })

      expect(sectionNamed(panel, 'Session').values).toEqual([
        secureMetadata.sessionId,
        secureMetadata.url
      ])
      expect(sectionNamed(panel, 'Session').values).toEqual([
        'b52d08fa17c6',
        SECURE_URL
      ])
    })
  })

  describe('missing data', () => {
    it('renders the placeholder when no metadata was captured', async () => {
      const panel = await mountMetadata(undefined, {})

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(shadowAll(panel, SECTION)).toHaveLength(0)
    })

    it('renders the placeholder before a provider supplies anything', async () => {
      const panel = await mount<DevtoolsMetadata>(PANEL)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
    })

    it('renders the placeholder when only the pending buffer was captured', async () => {
      const panel = await mountMetadata(undefined, {
        [PENDING_SESSION_KEY]: loginMetadata
      })

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
    })

    it('renders no section for metadata carrying nothing but its trace type', async () => {
      const panel = await mountMetadata(metadata())

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(0)
      expect(shadowAll(panel, SECTION)).toHaveLength(0)
    })

    it('surfaces no viewport row for a capture that carried no dimensions', async () => {
      // The viewport can reach the panel before it is serialized; a `0 × 0 px`
      // row would read as a captured size rather than a missing one.
      const panel = await mountMetadata(
        metadata({
          viewport: {
            width: 0,
            height: 0,
            offsetLeft: 0,
            offsetTop: 0,
            scale: 1
          }
        })
      )

      expect(shadowAll(panel, SECTION)).toHaveLength(0)
      expect(shadowAll(panel, ROW)).toHaveLength(0)
    })
  })
})
