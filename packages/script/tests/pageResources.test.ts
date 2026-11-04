/** @vitest-environment happy-dom */
import {
  PAGE_RESOURCE_LIMITS,
  PAGE_RESOURCE_READ_TIMEOUT_MS,
  resourceUrlKey
} from '@wdio/devtools-shared'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  PageResourceCollector,
  type ObservedLoad
} from '../src/collectors/pageResources.js'
import { ResourceTimingCollector } from '../src/collectors/resourceTiming.js'

const CSS = 'https://app.test/static/site.css'
const FONT = 'https://cdn.test/fonts/icons.woff2'

function load(overrides: Partial<ObservedLoad> = {}): ObservedLoad {
  return { name: CSS, initiatorType: 'link', startTime: 10, ...overrides }
}

function respond(
  body: string,
  contentType: string | null,
  ok = true
): Response {
  return {
    ok,
    headers: { get: () => contentType },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  } as unknown as Response
}

/** A fetch answering from a table, recording what it was asked. */
function fakeFetch(table: Record<string, Response | Error>) {
  return vi.fn<typeof fetch>(async (input) => {
    const answer = table[String(input)]
    if (answer instanceof Error || !answer) {
      throw answer ?? new Error('no route')
    }
    return answer
  })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function decode(data: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  )
}

describe('PageResourceCollector', () => {
  it('reads nothing back for a drain that names no mode', async () => {
    const fetch = fakeFetch({ [CSS]: respond('a{}', 'text/css') })
    const collector = new PageResourceCollector(fetch)
    collector.noteLoad(load())

    expect(collector.drain(undefined)).toBeUndefined()
    expect(collector.drain({ resources: 'none' })).toBeUndefined()
    await settle()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads a stylesheet and a font once each from the cache, and reports each read', async () => {
    const fetch = fakeFetch({
      [CSS]: respond('body{color:red}', 'text/css; charset=utf-8'),
      [FONT]: respond('wOF2', 'font/woff2')
    })
    const collector = new PageResourceCollector(fetch)
    collector.noteLoad(load())
    collector.noteLoad(load())
    collector.noteLoad(load({ name: FONT, initiatorType: 'css' }))

    const first = collector.drain({ resources: 'styles' })!
    expect(first.resourceReReads.map((r) => r.url)).toEqual([CSS, FONT])
    expect(first.pendingResources).toBe(2)
    await settle()

    const second = collector.drain({ resources: 'styles' })!
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'force-cache' })
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(
      second.pageResources.map((r) => [r.url, r.kind, r.mimeType, r.size])
    ).toEqual([
      [CSS, 'stylesheet', 'text/css', 15],
      [FONT, 'font', 'font/woff2', 4]
    ])
    expect(decode(second.pageResources[0].data)).toBe('body{color:red}')
    expect(second.pendingResources).toBe(0)
    expect(second.resourceReReads).toEqual([])
  })

  it('skips images, scripts, other initiators, skipped hosts and oversized loads without reading them', async () => {
    const fetch = fakeFetch({})
    const collector = new PageResourceCollector(fetch)
    collector.noteLoad(
      load({ name: 'https://app.test/bg.png', initiatorType: 'css' })
    )
    collector.noteLoad(
      load({ name: 'https://app.test/app.js', initiatorType: 'link' })
    )
    collector.noteLoad(load({ initiatorType: 'fetch' }))
    collector.noteLoad(load({ name: 'https://www.google-analytics.com/x.css' }))
    collector.noteLoad(
      load({ decodedBodySize: PAGE_RESOURCE_LIMITS.maxResourceBytes + 1 })
    )

    expect(collector.drain({ resources: 'styles' })!.pendingResources).toBe(0)
    await settle()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('drops a body that is neither a stylesheet nor a font, or over the cap once read', async () => {
    const big = 'x'.repeat(PAGE_RESOURCE_LIMITS.maxResourceBytes + 1)
    const collector = new PageResourceCollector(
      fakeFetch({
        [CSS]: respond('<html>', 'text/html'),
        [FONT]: respond(big, 'font/woff2')
      })
    )
    collector.noteLoad(load())
    collector.noteLoad(load({ name: FONT, initiatorType: 'css' }))
    collector.drain({ resources: 'styles' })
    await settle()

    expect(collector.drain({ resources: 'styles' })!.pageResources).toEqual([])
  })

  it('falls back to the parsed rules of a same-origin stylesheet it cannot read again', async () => {
    const url = `${location.origin}/theme.css`
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([
      { href: url, cssRules: [{ cssText: 'p { margin: 0px; }' }] }
    ] as unknown as StyleSheetList)
    const collector = new PageResourceCollector(fakeFetch({}))
    collector.noteLoad(load({ name: url }))
    collector.drain({ resources: 'styles' })
    await settle()

    const [resource] = collector.drain({ resources: 'styles' })!.pageResources
    expect(resource.kind).toBe('stylesheet')
    expect(decode(resource.data)).toBe('p { margin: 0px; }')
  })

  it('returns no more than a drain’s byte cap at once, leaving the rest pending', async () => {
    const full = 'y'.repeat(PAGE_RESOURCE_LIMITS.maxResourceBytes)
    const urls = [1, 2, 3, 4, 5].map((n) => `https://app.test/${n}.css`)
    const collector = new PageResourceCollector(
      fakeFetch(
        Object.fromEntries(urls.map((u) => [u, respond(full, 'text/css')]))
      )
    )
    urls.forEach((name) => collector.noteLoad(load({ name })))
    collector.drain({ resources: 'styles' })
    await settle()
    await settle()

    const first = collector.drain({ resources: 'styles' })!
    expect(first.pageResources).toHaveLength(4)
    expect(first.pendingResources).toBe(1)
    expect(
      collector.drain({ resources: 'styles' })!.pageResources
    ).toHaveLength(1)
  })

  it('skips a resource the run already stored, so a later document does not ship it again', async () => {
    const fetch = fakeFetch({ [CSS]: respond('a{}', 'text/css') })
    const collector = new PageResourceCollector(fetch)
    collector.noteLoad(load())
    const drained = collector.drain({
      resources: 'styles',
      stored: [resourceUrlKey(CSS)]
    })!
    await settle()

    expect(fetch).not.toHaveBeenCalled()
    expect(drained.pendingResources).toBe(0)
    expect(drained.resourceReReads).toEqual([])
  })

  it('counts a read that never answers as finished once it times out', async () => {
    const controller = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)
    const hung = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('timed out', 'TimeoutError'))
          )
        )
    )
    const collector = new PageResourceCollector(hung)
    collector.noteLoad(load())
    expect(collector.drain({ resources: 'styles' })!.pendingResources).toBe(1)
    expect(timeout).toHaveBeenCalledWith(PAGE_RESOURCE_READ_TIMEOUT_MS)

    controller.abort()
    await settle()

    expect(collector.drain({ resources: 'styles' })!.pendingResources).toBe(0)
    timeout.mockRestore()
  })

  it('starts a load noted after the first trace drain without waiting for another drain', async () => {
    const fetch = fakeFetch({ [CSS]: respond('a{}', 'text/css') })
    const collector = new PageResourceCollector(fetch)
    collector.drain({ resources: 'styles' })
    collector.noteLoad(load())
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('ResourceTimingCollector with page resources', () => {
  let buffer: Record<string, unknown[]>

  beforeEach(() => {
    buffer = { navigation: [], resource: [] }
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(
      (type: string) => (buffer[type] ?? []) as PerformanceEntry[]
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the collector’s own read out of the page’s network rows', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(500)
    const fetch = fakeFetch({ [CSS]: respond('a{}', 'text/css') })
    const pageResources = new PageResourceCollector(fetch)
    pageResources.drain({ resources: 'styles' })
    buffer.resource = [
      {
        name: CSS,
        entryType: 'resource',
        initiatorType: 'link',
        startTime: 10,
        responseEnd: 20
      },
      {
        name: CSS,
        entryType: 'resource',
        initiatorType: 'fetch',
        startTime: 500,
        responseEnd: 510
      }
    ]

    const rows = new ResourceTimingCollector(
      () => false,
      pageResources
    ).getArtifacts()

    expect(rows.map((r) => r.startTime)).toEqual([10])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('claims only the entry starting at its read, never a page fetch of the same URL a moment later', () => {
    vi.spyOn(performance, 'now').mockReturnValue(500)
    const pageResources = new PageResourceCollector(
      fakeFetch({ [CSS]: respond('a{}', 'text/css') })
    )
    pageResources.drain({ resources: 'styles' })
    buffer.resource = [
      {
        name: CSS,
        entryType: 'resource',
        initiatorType: 'link',
        startTime: 10,
        responseEnd: 20
      },
      {
        name: CSS,
        entryType: 'resource',
        initiatorType: 'fetch',
        startTime: 560,
        responseEnd: 570
      },
      {
        name: CSS,
        entryType: 'resource',
        initiatorType: 'fetch',
        startTime: 501,
        responseEnd: 510
      }
    ]

    const rows = new ResourceTimingCollector(
      () => false,
      pageResources
    ).getArtifacts()

    expect(rows.map((r) => r.startTime)).toEqual([10, 560])
  })
})
