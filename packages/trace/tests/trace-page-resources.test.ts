import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  NETWORK_CAPTURE_SOURCE,
  TRACE_ZIP_ENTRIES,
  type NetworkRequest,
  type PageResource,
  type TraceMutation
} from '@wdio/devtools-shared'

import {
  buildPageResourceEntries,
  referencedResourceUrls
} from '../src/trace-page-resources.js'
import { withoutResourceReReads } from '../src/trace-network.js'
import { writeTraceZip, type TraceCapturer } from '../src/trace-exporter.js'
import { parseTraceZip } from '../src/trace-reader.js'

const PAGE = 'https://site.test/login'
const b64 = (text: string) => Buffer.from(text).toString('base64')
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

function resource(
  url: string,
  body: string,
  kind: PageResource['kind'] = 'stylesheet'
): PageResource {
  return {
    url,
    kind,
    mimeType: kind === 'stylesheet' ? 'text/css' : 'font/woff2',
    data: b64(body),
    size: Buffer.byteLength(body)
  }
}

const el = (
  type: string,
  props: Record<string, unknown> = {},
  ...children: unknown[]
) => ({
  type,
  props: { ...props, children }
})

function anchor(url: string, ...head: unknown[]): TraceMutation {
  return {
    type: 'childList',
    url,
    timestamp: 1,
    addedNodes: [el('html', {}, el('head', {}, ...head), el('body'))],
    removedNodes: []
  }
}

const SITE_CSS = resource(
  'https://site.test/css/site.css',
  '@import "parts/a.css"; @font-face { src: url(../fonts/f.woff2) } .x { background: url(bg.png) }'
)
const PART_CSS = resource(
  'https://site.test/css/parts/a.css',
  '@import "../site.css"; p{}'
)
const FONT = resource('https://site.test/fonts/f.woff2', 'wOF2', 'font')
const UNUSED = resource('https://site.test/other.css', 'q{}')
const STORED = [SITE_CSS, PART_CSS, FONT, UNUSED]
const byUrl = new Map(STORED.map((r) => [r.url, r]))

describe('referencedResourceUrls', () => {
  it('follows a linked stylesheet into its imports and fonts, resolved against each stylesheet, cycles included', () => {
    const urls = referencedResourceUrls(
      [anchor(PAGE, el('link', { rel: 'stylesheet', href: 'css/site.css' }))],
      byUrl
    )
    expect(urls.sort()).toEqual([PART_CSS.url, SITE_CSS.url, FONT.url].sort())
  })

  it('reads <style> text, style attributes, preloads and later mutations against the document URL', () => {
    const urls = referencedResourceUrls(
      [
        anchor(
          PAGE,
          el('style', {}, '@font-face{src:url("/fonts/f.woff2")}'),
          el('link', { rel: 'preload', as: 'style', href: '/other.css' })
        ),
        {
          type: 'attributes',
          target: '3',
          attributeName: 'style',
          attributeValue: 'background:url(/css/parts/a.css)',
          addedNodes: [],
          removedNodes: [],
          timestamp: 2
        }
      ],
      byUrl
    )
    expect(urls).toEqual(
      expect.arrayContaining([FONT.url, UNUSED.url, PART_CSS.url])
    )
  })

  it('walks a node with more children than a spread can take', () => {
    const children: unknown[] = Array.from({ length: 200_000 }, () => 'x')
    children.push(el('link', { rel: 'stylesheet', href: '/other.css' }))
    const wide = { type: 'body', props: { children } }
    const mutation: TraceMutation = {
      type: 'childList',
      url: PAGE,
      timestamp: 1,
      addedNodes: [el('html', {}, wide)],
      removedNodes: []
    }
    expect(referencedResourceUrls([mutation], byUrl)).toEqual([UNUSED.url])
  })

  it('reads nothing when the run stored nothing', () => {
    expect(
      referencedResourceUrls(
        [anchor(PAGE, el('link', { rel: 'stylesheet', href: 'css/site.css' }))],
        new Map()
      )
    ).toEqual([])
  })

  it('honours a document <base href>', () => {
    const urls = referencedResourceUrls(
      [
        anchor(
          PAGE,
          el('base', { href: 'https://site.test/css/' }),
          el('link', { rel: 'stylesheet', href: 'parts/a.css' })
        )
      ],
      byUrl
    )
    expect(urls).toContain(PART_CSS.url)
  })
})

describe('buildPageResourceEntries', () => {
  it('stores only what the DOM uses, each body once by content hash', () => {
    const twin = resource('https://cdn.test/f.woff2', 'wOF2', 'font')
    const { resources, indexNdjson } = buildPageResourceEntries(
      [...STORED, twin],
      [
        anchor(
          PAGE,
          el('link', { rel: 'stylesheet', href: '/fonts/f.woff2' }),
          el('link', { rel: 'stylesheet', href: 'https://cdn.test/f.woff2' })
        )
      ]
    )
    expect(resources.map((r) => r.resourceName)).toEqual([sha1('wOF2')])
    const index = strFromU8(indexNdjson)
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(index).toEqual([
      {
        url: FONT.url,
        sha1: sha1('wOF2'),
        mimeType: 'font/woff2',
        kind: 'font',
        size: 4
      },
      {
        url: twin.url,
        sha1: sha1('wOF2'),
        mimeType: 'font/woff2',
        kind: 'font',
        size: 4
      }
    ])
  })

  it('leaves a resource past the archive cap out of the index, so it replays live', () => {
    const { resources, indexNdjson } = buildPageResourceEntries(
      STORED,
      [
        anchor(
          PAGE,
          el('link', { rel: 'stylesheet', href: '/other.css' }),
          el('link', { rel: 'stylesheet', href: '/fonts/f.woff2' })
        )
      ],
      { maxTraceBytes: 3 }
    )
    expect(resources.map((r) => r.resourceName)).toEqual([sha1('q{}')])
    expect(strFromU8(indexNdjson)).not.toContain(FONT.url)
  })

  it('writes nothing for a trace without stored resources', () => {
    const { resources, indexNdjson } = buildPageResourceEntries(undefined, [
      anchor(PAGE)
    ])
    expect(resources).toEqual([])
    expect(indexNdjson.length).toBe(0)
  })
})

describe('withoutResourceReReads', () => {
  const read = { url: SITE_CSS.url, startedAt: 5000, loadedAt: 1000 }
  const row = (
    id: string,
    wallTime: number | undefined,
    extra: Partial<NetworkRequest> = {}
  ): NetworkRequest =>
    ({
      id,
      url: SITE_CSS.url,
      method: 'GET',
      timestamp: 9999,
      ...(wallTime === undefined ? {} : { wallTime }),
      ...extra
    }) as NetworkRequest

  it('drops the driver-side row whose browser-clock start is the read\u2019s, keeping the page\u2019s load and a later page\u2019s', () => {
    const rows = [
      row('load', 1000),
      row('read', 5003),
      row('next-page', 20_000)
    ]
    expect(withoutResourceReReads(rows, [read]).map((r) => r.id)).toEqual([
      'load',
      'next-page'
    ])
  })

  it('keeps the page\u2019s real load whose receipt stamp lags past the read, judging by the browser clock', () => {
    const rows = [row('load', 1000, { timestamp: 5004 }), row('read', 5002)]
    expect(withoutResourceReReads(rows, [read]).map((r) => r.id)).toEqual([
      'load'
    ])
  })

  it('keeps a row with no browser-clock start rather than guess, leaving a duplicate', () => {
    expect(
      withoutResourceReReads([row('read?', undefined)], [read])
    ).toHaveLength(1)
  })

  it('keeps a row the browser marked as a stylesheet or font load, and drops one marked as a fetch', () => {
    const style = row('style', 5001, {
      requestHeaders: { 'Sec-Fetch-Dest': 'style' }
    })
    const fetched = row('fetch', 5002, {
      requestHeaders: { 'sec-fetch-dest': 'empty' }
    })
    expect(
      withoutResourceReReads([style, fetched], [read]).map((r) => r.id)
    ).toEqual(['style'])
  })

  it.each(['style', 'font'])(
    'keeps a row marked Sec-Fetch-Dest %s even at the read\u2019s exact start',
    (dest) => {
      const rows = [
        row('own-load', 5000, { requestHeaders: { 'sec-fetch-dest': dest } })
      ]
      expect(withoutResourceReReads(rows, [read])).toEqual(rows)
    }
  )

  it('keeps a row without wallTime even at the read\u2019s URL and receipt time', () => {
    const rows = [row('no-clock', undefined, { timestamp: 5000 })]
    expect(withoutResourceReReads(rows, [read])).toEqual(rows)
  })

  it('never takes a Resource Timing row, which the collector already kept its read out of', () => {
    const rows = [
      row('rt', 5001, { source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING })
    ]
    expect(withoutResourceReReads(rows, [read])).toHaveLength(1)
  })
})

describe('a trace with page resources, written and read back', () => {
  it('carries the used resources to the player and drops the re-read rows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-resources-'))
    const capturer: TraceCapturer = {
      mutations: [
        anchor(PAGE, el('link', { rel: 'stylesheet', href: '/css/site.css' }))
      ],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [
        {
          id: 'load',
          url: SITE_CSS.url,
          method: 'GET',
          timestamp: 1000
        } as NetworkRequest,
        {
          id: 'read',
          url: SITE_CSS.url,
          method: 'GET',
          timestamp: 5002,
          wallTime: 5002
        } as NetworkRequest
      ],
      commandsLog: [],
      sources: new Map(),
      pageResources: STORED,
      resourceReReads: [{ url: SITE_CSS.url, startedAt: 5000, loadedAt: 1000 }]
    }
    const zipPath = await writeTraceZip(capturer, {
      outputDir: dir,
      sessionId: 's1'
    })
    const bytes = new Uint8Array(await fs.readFile(zipPath))

    expect(Object.keys(unzipSync(bytes))).toContain(
      TRACE_ZIP_ENTRIES.pageResources
    )
    const { trace } = parseTraceZip(bytes)
    expect(trace.pageResources?.map((r) => [r.url, r.kind]).sort()).toEqual(
      [
        [SITE_CSS.url, 'stylesheet'],
        [PART_CSS.url, 'stylesheet'],
        [FONT.url, 'font']
      ].sort()
    )
    expect(trace.pageResources?.find((r) => r.url === FONT.url)?.data).toBe(
      b64('wOF2')
    )
    expect(trace.networkRequests.map((r) => r.url)).toHaveLength(1)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reads no page resources from a zip without the index', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'page-resources-'))
    const zipPath = await writeTraceZip(
      {
        mutations: [],
        traceLogs: [],
        consoleLogs: [],
        networkRequests: [],
        commandsLog: [],
        sources: new Map()
      },
      { outputDir: dir, sessionId: 's2' }
    )
    const { trace } = parseTraceZip(new Uint8Array(await fs.readFile(zipPath)))
    expect(trace.pageResources).toBeUndefined()
    await fs.rm(dir, { recursive: true, force: true })
  })
})
