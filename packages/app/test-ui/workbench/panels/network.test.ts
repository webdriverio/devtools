import type { NetworkRequest } from '@wdio/devtools-shared'

import { networkRequestContext } from '@/controller/context.js'
import {
  contentType,
  formatBytes,
  formatTime,
  getFileName,
  statusKind
} from '@/utils/network-helpers.js'
import '@components/workbench/network.js'
import type { DevtoolsNetwork } from '@components/workbench/network.js'
import {
  networkWindow,
  waterfallBar
} from '@components/workbench/network/waterfall.js'

import { mount, mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import { loginNetwork, networkRequest } from './fixtures.js'

const PANEL = 'wdio-devtools-network'
const ROW = '.request-row'
const COLUMN_HEADERS = '.requests-header > div'
const NAME = '.req-name'
const METHOD = '.req-method'
const STATUS = '.req-status'
const TYPE = '.req-type'
const DURATION = '.req-dur'
const SIZE = '.req-size'
const TYPE_DOT = '.type-dot'
const BAR = '.wf-bar'
const DETAIL = '.request-detail'
const DETAIL_SECTION = '.request-detail .detail-section'
const ERROR_VALUE = '.request-detail .v.kind-error'
const TYPE_TAB = '.filter-tab'
const ACTIVE_TYPE_TAB = '.filter-tab.active'
const SEARCH = '.search-input'
const TOOLBAR = '.network-header'
const FILTER_EMPTY = '.filter-empty'
const PLACEHOLDER = 'wdio-devtools-placeholder'
const EMPTY_ICON = '.empty-state-icon'
const EMPTY_HEADING = '.empty-state-text'
const EMPTY_DETAIL = '.empty-state-detail'
const SKELETON = '.ph-item'

/** Glyph the panel hands its empty-state placeholder. */
const NETWORK_GLYPH = '🌐'

/** The panel's own "no value" glyph, distinct from the `-` `formatBytes`
 *  returns — an em dash, written out so the two can't be confused. */
const NO_VALUE = '—'

interface DetailSection {
  title: string
  keys: string[]
  values: string[]
}

// --- Derived expectations ---------------------------------------------------
// Each column's expected content is computed from the fixture through the same
// exported helper the panel calls, so a column wired to the wrong field (or to
// the wrong formatter) fails even though the literal list still reads right.
// The literals stay alongside as the pinned user-visible strings.

const expectedNames = (requests: NetworkRequest[]) =>
  requests.map((request) => getFileName(request.url))

const expectedTypes = (requests: NetworkRequest[]) => requests.map(contentType)

const expectedDurations = (requests: NetworkRequest[]) =>
  requests.map((request) =>
    typeof request.time === 'number' && request.time > 0
      ? formatTime(request.time)
      : NO_VALUE
  )

const expectedSizes = (requests: NetworkRequest[]) =>
  requests.map((request) => formatBytes(request.size))

const expectedKindClasses = (requests: NetworkRequest[]) =>
  requests.map(
    (request) => `kind-${statusKind(request.status, Boolean(request.error))}`
  )

/** A captured body as the detail panel re-indents it, then whitespace-collapsed
 *  the way `text()` collapses the rendered `<pre>`. */
const prettyJson = (body: string | undefined) =>
  JSON.stringify(JSON.parse(body ?? ''), null, 2).replace(/\s+/g, ' ')

/** Bar width per timed request, scaled against the set actually in view — the
 *  panel scales against the *filtered* list, which is what makes this derived
 *  form worth asserting. */
const expectedBarWidths = (inView: NetworkRequest[]) => {
  const range = networkWindow(inView)
  return inView
    .filter((request) => typeof request.time === 'number' && request.time > 0)
    .map((request) => `${waterfallBar(request, range).width}%`)
}

async function mountNetwork(
  requests: NetworkRequest[]
): Promise<DevtoolsNetwork> {
  const panel = await mountWithContext<DevtoolsNetwork>(PANEL, [
    { context: networkRequestContext, value: requests }
  ])
  await settle(panel)
  return panel
}

const rows = (panel: DevtoolsNetwork) => shadowAll(panel, ROW)

const selectedRows = (panel: DevtoolsNetwork) =>
  rows(panel).filter((row) => row.classList.contains('selected'))

const kindClassOf = (el: Element) =>
  [...el.classList].find((name) => name.startsWith('kind-'))

const dotClassOf = (dot: Element) =>
  [...dot.classList].find((name) => name !== 'type-dot')

const attrOf = (el: Element | null, name: string) =>
  el?.getAttribute(name) ?? null

/** Bar width per row — `null` where the row drew no bar at all. */
const barWidths = (panel: DevtoolsNetwork) =>
  rows(panel).map((row) => shadow<HTMLElement>(row, BAR)?.style.width ?? null)

/** Both halves of a bar's geometry, so a bar wired to the wrong half of the
 *  helper's `{ offset, width }` fails on the row where the two differ. */
const barGeometry = (panel: DevtoolsNetwork) =>
  rows(panel).map((row) => {
    const bar = shadow<HTMLElement>(row, BAR)
    return bar ? { left: bar.style.left, width: bar.style.width } : null
  })

const detailSections = (panel: DevtoolsNetwork): DetailSection[] =>
  shadowAll(panel, DETAIL_SECTION).map((section) => ({
    title: text(shadow(section, '.detail-title')),
    keys: texts(section, '.k'),
    values: texts(section, '.v')
  }))

async function clickRow(panel: DevtoolsNetwork, index: number) {
  const row = rows(panel)[index]
  if (!row) {
    throw new Error(`no request row at index ${index}`)
  }
  row.click()
  await settle(panel)
}

async function clickTypeTab(panel: DevtoolsNetwork, label: string) {
  const tab = shadowAll(panel, TYPE_TAB).find(
    (button) => text(button) === label
  )
  if (!tab) {
    throw new Error(`no resource type tab labelled "${label}"`)
  }
  tab.click()
  await settle(panel)
}

async function search(panel: DevtoolsNetwork, query: string) {
  const input = shadow<HTMLInputElement>(panel, SEARCH)
  if (!input) {
    throw new Error('the network toolbar rendered no search input')
  }
  input.value = query
  input.dispatchEvent(new Event('input'))
  await settle(panel)
}

describe('wdio-devtools-network', () => {
  describe('request list', () => {
    it('renders one row per captured request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(rows(panel)).toHaveLength(7)
    })

    it('renders a column header per request field', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, COLUMN_HEADERS)).toEqual([
        'Name',
        'Method',
        'Status',
        'Type',
        'Waterfall',
        'Duration',
        'Size'
      ])
    })

    it('names each row after the file its URL points at', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, NAME)).toEqual(expectedNames(loginNetwork.requests))
      expect(texts(panel, NAME)).toEqual([
        'login',
        'jquery-1.11.3.min.js',
        'session',
        'missing-avatar.png',
        'inter.woff2',
        'authenticate',
        'notifications'
      ])
    })

    it('renders the method of each request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, METHOD)).toEqual([
        'GET',
        'GET',
        'POST',
        'GET',
        'GET',
        'GET',
        'GET'
      ])
    })

    it('renders the content type of each request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, TYPE)).toEqual(expectedTypes(loginNetwork.requests))
      expect(texts(panel, TYPE)).toEqual([
        'text/html',
        'application/javascript',
        'application/json',
        'image',
        'font',
        'document',
        'fetch'
      ])
    })

    it('renders the duration and transferred size of each request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, DURATION)).toEqual(
        expectedDurations(loginNetwork.requests)
      )
      expect(texts(panel, SIZE)).toEqual(expectedSizes(loginNetwork.requests))
      // The two "missing" glyphs differ: the panel writes an em dash for an
      // absent duration, `formatBytes` a hyphen for an absent size.
      expect(texts(panel, DURATION)).toEqual([
        '800ms',
        '400ms',
        '8ms',
        '120ms',
        '200ms',
        '40ms',
        '—'
      ])
      expect(texts(panel, SIZE)).toEqual([
        '12KB',
        '234KB',
        '320B',
        '-',
        '-',
        '-',
        '-'
      ])
    })

    // Literals only, deliberately: routing the expectation through the same
    // helper the panel calls made this list agree with itself while it
    // contradicted the Type column above — a document row dotted `type-other`.
    it('marks each row with the dot of the type its Type column names', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(shadowAll(panel, TYPE_DOT).map(dotClassOf)).toEqual([
        'type-html',
        'type-js',
        'type-fetch',
        'type-image',
        'type-font',
        // A document with no response headers and no `.html` in its URL — its
        // dot follows the captured type, as the Type column already did.
        'type-html',
        'type-fetch'
      ])
    })
  })

  describe('status', () => {
    it('renders the status code of each finished request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(texts(panel, STATUS)).toEqual([
        '200',
        '200',
        '200',
        '404',
        'ERR',
        '302',
        '—'
      ])
    })

    it('buckets 2xx as ok, 3xx as redirect and 4xx as error', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(shadowAll(panel, STATUS).map(kindClassOf)).toEqual(
        expectedKindClasses(loginNetwork.requests)
      )
      expect(shadowAll(panel, STATUS).map(kindClassOf)).toEqual([
        'kind-ok',
        'kind-ok',
        'kind-ok',
        'kind-error',
        'kind-error',
        'kind-redirect',
        'kind-pending'
      ])
    })

    it('renders a request that never got a status as pending', async () => {
      const panel = await mountNetwork([loginNetwork.pending])

      expect(text(shadow(panel, STATUS))).toBe('—')
      expect(kindClassOf(shadowAll(panel, STATUS)[0])).toBe('kind-pending')
    })
  })

  describe('waterfall', () => {
    it('scales every bar against the slowest request in view', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(barWidths(panel)).toEqual([
        ...expectedBarWidths(loginNetwork.requests),
        // The in-flight request draws no bar at all.
        null
      ])
      // 800ms is the slowest; the 8ms request is held at the visible minimum.
      // Read with the offset each bar was placed at: every bar starts at the
      // left edge, so only the pairing tells a width bound to `left` apart from
      // one bound to `width`.
      expect(barGeometry(panel)).toEqual([
        { left: '0%', width: '100%' },
        { left: '0%', width: '50%' },
        { left: '0%', width: '2%' },
        { left: '0%', width: '15%' },
        { left: '0%', width: '25%' },
        { left: '0%', width: '5%' },
        null
      ])
    })

    it('draws no bar and dashes the duration of an in-flight request', async () => {
      const panel = await mountNetwork([loginNetwork.pending])

      expect(shadowAll(panel, BAR)).toHaveLength(0)
      expect(text(shadow(panel, DURATION))).toBe('—')
      expect(
        shadowAll(panel, DURATION)[0].classList.contains('req-dur-empty')
      ).toBe(true)
    })

    it("colours a failed request's bar as an error", async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(shadowAll(panel, BAR).map(kindClassOf)).toEqual([
        'kind-ok',
        'kind-ok',
        'kind-ok',
        'kind-error',
        'kind-error',
        'kind-redirect'
      ])
    })

    it('rescales the bars against the slowest request left after filtering', async () => {
      const unfiltered = await mountNetwork(loginNetwork.requests)
      const panel = await mountNetwork(loginNetwork.requests)
      await clickTypeTab(panel, 'JS')

      // Scaled against the filtered set, so the 400ms script now fills the
      // track; scaling against the unfiltered 800ms maximum would give 50% —
      // which is what the same request's bar reads in the unfiltered panel.
      expect(barWidths(panel)).toEqual(expectedBarWidths([loginNetwork.script]))
      expect(barWidths(panel)).toEqual(['100%'])
      expect(barWidths(unfiltered)[1]).toBe('50%')
    })
  })

  describe('detail panel', () => {
    it('renders no detail panel until a row is clicked', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(shadowAll(panel, DETAIL)).toHaveLength(0)
      expect(selectedRows(panel)).toHaveLength(0)
    })

    it('expands the clicked row into a detail panel and selects only that row', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)

      expect(shadowAll(panel, DETAIL)).toHaveLength(1)
      expect(selectedRows(panel)).toHaveLength(1)
      expect(text(shadow(selectedRows(panel)[0], NAME))).toBe('session')
    })

    it("summarises the clicked request's URL, method, status, timing and size", async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)

      const { api } = loginNetwork
      const [general] = detailSections(panel)
      expect(general.keys).toEqual([
        'Request URL',
        'Method',
        'Status',
        'Type',
        'Time',
        'Size'
      ])
      expect(general.values).toEqual([
        api.url,
        api.method,
        `${api.status} ${api.statusText}`,
        contentType(api),
        formatTime(api.time),
        formatBytes(api.size)
      ])
      expect(general.values).toEqual([
        'https://the-internet.herokuapp.com/api/session',
        'POST',
        '200 OK',
        'application/json',
        '8ms',
        '320B'
      ])
    })

    it('lists the request and response headers of the clicked request', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)

      const sections = detailSections(panel)
      expect(sections.map((section) => section.title)).toEqual([
        'General',
        'Request Headers',
        'Request Body',
        'Response Headers',
        'Response Body'
      ])
      expect(sections[1].keys).toEqual(['content-type'])
      expect(sections[1].values).toEqual(['application/json'])
      expect(sections[3].keys).toEqual(['content-type'])
      expect(sections[3].values).toEqual(['application/json'])
    })

    it('pretty-prints a JSON request and response body', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)

      const sections = detailSections(panel)
      // Re-indented from the captured wire body — `text()` then collapses the
      // indentation, so the assertion is on the reflow, not the whitespace.
      expect(sections[2].values).toEqual([
        prettyJson(loginNetwork.api.requestBody)
      ])
      expect(sections[4].values).toEqual([
        prettyJson(loginNetwork.api.responseBody)
      ])
      expect(sections[2].values).toEqual(['{ "sku": "AB-1", "qty": 2 }'])
      expect(sections[4].values).toEqual(['{ "ok": true, "items": 2 }'])
    })

    it('shows only the General section for a request with no headers or bodies', async () => {
      const panel = await mountNetwork([loginNetwork.pending])
      await clickRow(panel, 0)

      expect(detailSections(panel).map((section) => section.title)).toEqual([
        'General'
      ])
    })

    it('leaves out the timing and size of a request that has neither', async () => {
      const panel = await mountNetwork([loginNetwork.pending])
      await clickRow(panel, 0)

      const { pending } = loginNetwork
      const [general] = detailSections(panel)
      expect(general.keys).toEqual(['Request URL', 'Method', 'Status', 'Type'])
      expect(general.values).toEqual([
        pending.url,
        pending.method,
        NO_VALUE,
        contentType(pending)
      ])
      expect(general.values).toEqual([
        'https://the-internet.herokuapp.com/api/notifications?limit=4',
        'GET',
        '—',
        'fetch'
      ])
    })

    it('reports the transport error of a request that never got a status', async () => {
      const panel = await mountNetwork([loginNetwork.failedFont])
      await clickRow(panel, 0)

      const [general] = detailSections(panel)
      expect(general.keys).toEqual([
        'Request URL',
        'Method',
        'Status',
        'Type',
        'Time',
        'Error'
      ])
      // The missing status and the error message are both flagged as errors.
      expect(texts(panel, ERROR_VALUE)).toEqual([
        '—',
        'net::ERR_CONNECTION_REFUSED'
      ])
    })

    it('closes the detail panel when the selected row is clicked again', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)
      await clickRow(panel, 2)

      expect(shadowAll(panel, DETAIL)).toHaveLength(0)
      expect(selectedRows(panel)).toHaveLength(0)
    })

    it('moves the detail panel to another row when that row is clicked', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickRow(panel, 2)
      await clickRow(panel, 0)

      expect(selectedRows(panel)).toHaveLength(1)
      expect(detailSections(panel)[0].values[0]).toBe(
        'https://the-internet.herokuapp.com/login'
      )
    })
  })

  describe('filtering', () => {
    it('narrows the list to one resource type when its tab is clicked', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickTypeTab(panel, 'JS')

      expect(text(shadow(panel, ACTIVE_TYPE_TAB))).toBe('JS')
      expect(texts(panel, NAME)).toEqual(['jquery-1.11.3.min.js'])
    })

    // The HTML tab used to match nothing: a document was only dotted HTML when
    // its response headers said `text/html`, and the tab filtered on the same
    // narrower rule. Both documents here must reach it, headers or not.
    it('narrows the list to every document when the HTML tab is clicked', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickTypeTab(panel, 'HTML')

      expect(texts(panel, NAME)).toEqual(['login', 'authenticate'])
    })

    it('starts with the All type tab active', async () => {
      const panel = await mountNetwork(loginNetwork.requests)

      expect(text(shadow(panel, ACTIVE_TYPE_TAB))).toBe('All')
    })

    it('narrows the list to requests whose file name matches the search', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await search(panel, 'jquery-1.11.3.min.js')

      expect(texts(panel, NAME)).toEqual(['jquery-1.11.3.min.js'])
    })

    // Matches inside the URL but outside the name the row shows, so only the
    // filter's URL clause can find it.
    it('narrows the list by a path segment that is not the file name', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await search(panel, 'js/vendor')

      expect(texts(panel, NAME)).toEqual(['jquery-1.11.3.min.js'])
    })

    // The name a row shows isn't always a slice of the URL it was captured
    // with — this host reaches the list punycoded. Searching it exercises the
    // name clause of the filter on its own; the URL clause can't match `xn--`.
    it('narrows the list by the name a row displays, not only by its URL', async () => {
      const internationalHost = networkRequest({
        id: 'req-idn',
        url: 'https://münchen.example/?q=1'
      })
      const panel = await mountNetwork([internationalHost, loginNetwork.script])
      await search(panel, 'xn--')

      expect(texts(panel, NAME)).toEqual(['xn--mnchen-3ya.example'])
    })

    it('narrows the list by status code', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await search(panel, '404')

      expect(texts(panel, NAME)).toEqual(['missing-avatar.png'])
    })

    it('reports that nothing matches when a resource type has no requests', async () => {
      const panel = await mountNetwork(loginNetwork.requests)
      await clickTypeTab(panel, 'CSS')

      expect(rows(panel)).toHaveLength(0)
      expect(text(shadow(panel, FILTER_EMPTY))).toBe(
        'No requests match your filter'
      )
    })
  })

  describe('empty state', () => {
    it('renders the network placeholder when no requests have been captured', async () => {
      const panel = await mountNetwork([])

      const placeholder = shadow(panel, PLACEHOLDER)
      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(attrOf(placeholder, 'icon')).toBe(NETWORK_GLYPH)
      expect(attrOf(placeholder, 'heading')).toBe(
        'No network requests captured'
      )
      expect(attrOf(placeholder, 'description')).toBe(
        'Network requests will appear here as your tests run'
      )
    })

    // The copy is asserted inside the placeholder's own shadow root, not through
    // the panel's `textContent` — that stops at the placeholder's host and so
    // reads empty whether or not the words render.
    it('renders the copy it hands the placeholder as visible text', async () => {
      const panel = await mountNetwork([])
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(text(shadow(placeholder, EMPTY_HEADING))).toBe(
        'No network requests captured'
      )
      expect(text(shadow(placeholder, EMPTY_DETAIL))).toBe(
        'Network requests will appear here as your tests run'
      )
      expect(text(shadow(placeholder, EMPTY_ICON))).toBe(NETWORK_GLYPH)
    })

    it('explains the empty panel instead of drawing a loading skeleton', async () => {
      const panel = await mountNetwork([])
      const placeholder = shadow(panel, PLACEHOLDER)!

      expect(shadowAll(placeholder, SKELETON)).toHaveLength(0)
    })

    it('renders the placeholder before a provider supplies any requests', async () => {
      const panel = await mount<DevtoolsNetwork>(PANEL)

      expect(shadowAll(panel, PLACEHOLDER)).toHaveLength(1)
      expect(rows(panel)).toHaveLength(0)
    })

    it('renders no toolbar or column headers while the placeholder is showing', async () => {
      const panel = await mountNetwork([])

      expect(shadowAll(panel, TOOLBAR)).toHaveLength(0)
      expect(shadowAll(panel, COLUMN_HEADERS)).toHaveLength(0)
    })
  })
})
