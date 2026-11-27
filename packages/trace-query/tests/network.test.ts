import { describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES, MAX_LIST_TEXT_CHARS } from '../src/constants.js'
import { traceNetwork } from '../src/network.js'
import { traceNetworkRequest } from '../src/network-request.js'
import { traceStateOf } from '../src/open-trace.js'
import {
  ORIGIN,
  STORED_BODY,
  openBusyTrace,
  openChromeTrace,
  openHeavyRequestTrace,
  openResourceTimingTrace
} from './console-network-traces.js'
import { allPages, fixtures, openFixture } from './traces.js'

describe('traceNetwork over every adapter fixture', () => {
  it.each(fixtures)(
    'lists every request of $zipName without headers, its origin stated once',
    async ({ zipName, manifest }) => {
      const page = traceNetwork(await openFixture(zipName))
      expect(page.total).toBe(manifest.networkRequests.count)
      expect(page.nextCursor).toBeUndefined()
      expect(page.origin).toBe(ORIGIN)
      expect(page.byStatus).toEqual({ ok: manifest.networkRequests.count })
      expect(
        [...new Set(page.items.map((row) => `${page.origin}${row.url}`))].sort()
      ).toEqual([...manifest.networkRequests.urls].sort())
      for (const row of page.items) {
        expect(Object.keys(row)).not.toContain('requestHeaders')
      }
    }
  )

  it.each(fixtures)(
    'returns the headers of a $zipName request, and a body only when asked',
    async ({ zipName }) => {
      const handle = await openFixture(zipName)
      const detail = await traceNetworkRequest(handle, '0')
      expect(detail.url).toMatch(/^http:\/\/127\.0\.0\.1:4567\//)
      expect(Object.keys(detail.requestHeaders ?? {}).length).toBeGreaterThan(0)
      expect(detail).not.toHaveProperty('body')
      expect(detail).not.toHaveProperty('bodyUnavailable')
      const asked = await traceNetworkRequest(handle, '0', { body: true })
      expect(asked.bodyUnavailable).toBe(
        'The trace stored no body for this request'
      )
    }
  )
})

describe('traceNetwork on a Resource Timing trace', () => {
  it('reports a request with no status as unknown, never as an error', async () => {
    const page = traceNetwork(await openResourceTimingTrace())
    expect(page.items.map((row) => row.statusKind)).toEqual([
      'unknown',
      'unknown',
      'unknown'
    ])
    expect(page.byStatus).toEqual({ unknown: 3 })
    expect(page.items[0]).toEqual({
      id: '0',
      startMs: 150,
      durationMs: 50,
      statusKind: 'unknown',
      type: 'document',
      source: 'resource-timing',
      url: '/login'
    })
  })

  it('lists no Resource Timing row among the failures', async () => {
    const failed = traceNetwork(await openResourceTimingTrace(), {
      status: ['error']
    })
    expect(failed.items).toEqual([])
    expect(failed.total).toBe(0)
  })

  it('says what the capture could not see', async () => {
    const detail = await traceNetworkRequest(
      await openResourceTimingTrace(),
      '2',
      {
        body: true
      }
    )
    expect(detail.statusKind).toBe('unknown')
    expect(detail.note).toBe(
      'Resource Timing: this browser exposes no status, headers or body for the request'
    )
    expect(detail).not.toHaveProperty('requestHeaders')
    expect(detail).not.toHaveProperty('responseHeaders')
    expect(detail).not.toHaveProperty('method')
  })
})

describe('traceNetwork', () => {
  it('filters by status kind and keeps the failure reason', async () => {
    const page = traceNetwork(await openChromeTrace(), {
      status: ['error']
    })
    expect(
      page.items.map(({ status, statusText }) => ({ status, statusText }))
    ).toEqual([
      { status: 500, statusText: 'Internal Server Error' },
      { status: 0, statusText: 'net::ERR_CONNECTION_REFUSED' }
    ])
    expect(page.byStatus).toEqual({ ok: 3, error: 2 })
  })

  it('filters by a case-insensitive URL substring', async () => {
    const page = traceNetwork(await openChromeTrace(), { url: '/API/' })
    expect(page.items.map((row) => row.url)).toEqual([
      '/api/user?id=7',
      '/api/items',
      '/api/slow'
    ])
  })

  it('keeps the requests that overlap the time around an action', async () => {
    const page = traceNetwork(await openChromeTrace(), {
      action: 'call@3',
      windowMs: 100
    })
    expect(page.items.map((row) => row.url)).toEqual([
      '/api/slow',
      expect.stringMatching(/^https:\/\/analytics\.example\.com\//)
    ])
    expect(page.items[0]!.startMs).toBeLessThan(8900)
  })

  it('reads an empty status list as no filter', async () => {
    const handle = await openChromeTrace()
    expect(traceNetwork(handle, { status: [] }).total).toBe(
      traceNetwork(handle).total
    )
  })

  it('keeps another origin and cuts a long URL, saying how long it was', async () => {
    const page = traceNetwork(await openChromeTrace(), {
      url: 'analytics'
    })
    const row = page.items[0]!
    expect(row.url).toMatch(
      /^https:\/\/analytics\.example\.com\/collect\?q+… \(cut, 438 chars\)$/
    )
    expect(row.url).toHaveLength(MAX_LIST_TEXT_CHARS)
  })

  it.each([1_000, 1_200, 5_000])(
    'holds every page within %s characters to the end of the listing',
    async (maxChars) => {
      const handle = await openBusyTrace()
      const pages = allPages((cursor) =>
        traceNetwork(handle, { maxChars, cursor })
      )
      expect(pages.length).toBeGreaterThan(1)
      for (const page of pages) {
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(maxChars)
      }
      expect(pages.flatMap((page) => page.items)).toHaveLength(40)
    }
  )

  it('refuses a cursor from a listing with other filters, and shares one between equal filters', async () => {
    const handle = await openBusyTrace()
    const first = traceNetwork(handle, {
      status: ['ok', 'error'],
      maxChars: 2_000
    })
    expect(first.nextCursor).toBeDefined()
    expect(
      traceNetwork(handle, {
        status: ['error', 'ok'],
        maxChars: 2_000,
        cursor: first.nextCursor
      }).items.length
    ).toBeGreaterThan(0)
    expect(() =>
      traceNetwork(handle, {
        status: ['ok'],
        maxChars: 2_000,
        cursor: first.nextCursor
      })
    ).toThrow(/belongs to a different listing/)
  })

  it('reads a redirect, a 1xx and a request with no status apart', async () => {
    const handle = await openChromeTrace()
    const [first, second, third] =
      traceStateOf(handle).data.trace.networkRequests
    first!.status = 301
    second!.status = 101
    delete third!.status
    const kinds = traceNetwork(handle)
      .items.slice(0, 3)
      .map((row) => row.statusKind)
    expect(kinds).toEqual(['redirect', 'pending', 'pending'])
    expect(traceNetwork(handle).items[2]).not.toHaveProperty('status')
  })

  it('reports no reason for a request that succeeded', async () => {
    const page = traceNetwork(await openChromeTrace(), { status: ['ok'] })
    for (const row of page.items) {
      expect(row).not.toHaveProperty('statusText')
    }
  })
})

describe('traceNetworkRequest', () => {
  it('cuts a long header value, saying how long it was', async () => {
    const detail = await traceNetworkRequest(await openChromeTrace(), '0')
    const cookie = detail.requestHeaders?.cookie
    expect(cookie).toHaveLength(2000)
    expect(cookie?.endsWith('… (cut, 3008 chars)')).toBe(true)
    expect(detail.requestHeaders?.accept).toBe('text/html')
    expect(detail.mimeType).toBe('text/html')
  })

  it('returns a body the HAR inlined', async () => {
    const detail = await traceNetworkRequest(await openChromeTrace(), '1', {
      body: true
    })
    expect(detail.body).toBe('{"error":"user not found"}')
  })

  it('reads a stored body from the zip only when asked', async () => {
    const handle = await openChromeTrace()
    const read = vi.spyOn(traceStateOf(handle).archive, 'read')
    await traceNetworkRequest(handle, '2')
    expect(read).not.toHaveBeenCalled()
    const detail = await traceNetworkRequest(handle, '2', {
      body: true,
      maxBodyChars: 50
    })
    expect(read).toHaveBeenCalledTimes(1)
    const note = `… (cut, ${STORED_BODY.length} chars)`
    expect(detail.body).toBe(`${STORED_BODY.slice(0, 50 - note.length)}${note}`)
  })

  it('reports a stored body over the read limit by size without inflating it', async () => {
    const handle = await openChromeTrace()
    const { archive } = traceStateOf(handle)
    vi.spyOn(archive, 'sizeOf').mockReturnValue(MAX_BODY_BYTES + 1)
    const read = vi.spyOn(archive, 'read')
    const detail = await traceNetworkRequest(handle, '2', { body: true })
    expect(read).not.toHaveBeenCalled()
    expect(detail.bodyUnavailable).toBe(
      `The stored body is ${MAX_BODY_BYTES + 1} bytes, over the ${MAX_BODY_BYTES}-byte read limit`
    )
  })

  it('reports a stored body whose size the zip does not declare, without reading it', async () => {
    const handle = await openChromeTrace()
    const { archive } = traceStateOf(handle)
    vi.spyOn(archive, 'sizeOf').mockReturnValue(undefined)
    const read = vi.spyOn(archive, 'read')
    const detail = await traceNetworkRequest(handle, '2', { body: true })
    expect(read).not.toHaveBeenCalled()
    expect(detail.bodyUnavailable).toBe(
      'The zip declares no size for the stored body'
    )
  })

  it('reports a stored body that cannot be read, keeping the rest of the request', async () => {
    const handle = await openChromeTrace()
    vi.spyOn(traceStateOf(handle).archive, 'read').mockRejectedValue(
      new Error('invalid deflate data')
    )
    const detail = await traceNetworkRequest(handle, '2', { body: true })
    expect(detail.bodyUnavailable).toBe(
      'The stored body could not be read: invalid deflate data'
    )
    expect(detail.statusKind).toBe('ok')
  })

  it('names maxBodyChars when it is not a positive integer', async () => {
    await expect(
      traceNetworkRequest(await openChromeTrace(), '1', { maxBodyChars: 1.5 })
    ).rejects.toThrow('maxBodyChars must be a positive integer, got 1.5')
  })

  it.each([1_000, 1_500, 5_000, 20_000])(
    'holds the whole request within %s characters, headers before the body',
    async (maxChars) => {
      const handle = await openHeavyRequestTrace()
      const detail = await traceNetworkRequest(handle, '0', {
        body: true,
        maxChars
      })
      expect(JSON.stringify(detail).length).toBeLessThanOrEqual(maxChars)
      expect(detail.omittedHeaders).toBeGreaterThan(0)
      expect(detail.body?.startsWith('{"rows":"bbb')).toBe(true)
    }
  )

  it('gives the body no more than maxBodyChars, whatever the budget leaves', async () => {
    const detail = await traceNetworkRequest(
      await openHeavyRequestTrace(),
      '0',
      { body: true, maxChars: 200_000, maxBodyChars: 1_000 }
    )
    expect(detail.omittedHeaders).toBeUndefined()
    expect(detail.body).toHaveLength(1_000)
  })

  it('keeps a captured size of 0', async () => {
    const detail = await traceNetworkRequest(await openChromeTrace(), '3')
    expect(detail.size).toBe(0)
  })

  it('refuses a budget below the smallest a query accepts', async () => {
    const handle = await openChromeTrace()
    expect(() => traceNetwork(handle, { maxChars: 999 })).toThrow(
      'maxChars must be at least 1000'
    )
    await expect(
      traceNetworkRequest(handle, '0', { maxChars: 999 })
    ).rejects.toThrow('maxChars must be at least 1000')
  })

  it('refuses a request the trace does not hold', async () => {
    await expect(
      traceNetworkRequest(await openChromeTrace(), '99')
    ).rejects.toThrow('The trace has no request "99"')
  })
})
