import { describe, expect, it, vi, type Mock } from 'vitest'
import { describeUrl, downloadTrace } from '../src/download.js'
import type { HttpGet, HttpResponse } from '../src/types.js'
import { MAX_REDIRECTS } from '../src/constants.js'

const LIMITS = {
  allowedHosts: ['bucket.example.com', 'cdn.example.com'],
  allowPrivateNetwork: false,
  maxZipBytes: 10
}
const URL_WITH_TOKEN = new URL(
  'https://bucket.example.com/run-1/trace.zip?X-Amz-Signature=secret'
)

function response(
  status: number,
  fields: {
    location?: string
    chunks?: number[][]
    contentLength?: number
  } = {}
): HttpResponse & { discard: Mock<() => void> } {
  const chunks = (fields.chunks ?? []).map((bytes) => new Uint8Array(bytes))
  return {
    status,
    location: fields.location,
    contentLength: fields.contentLength,
    body: (async function* () {
      yield* chunks
    })(),
    discard: vi.fn<() => void>()
  }
}

function serving(...responses: HttpResponse[]): HttpGet & { urls: string[] } {
  const urls: string[] = []
  const get = (async (url: URL) => {
    urls.push(url.href)
    return responses.shift()!
  }) as HttpGet & { urls: string[] }
  get.urls = urls
  return get
}

describe('describeUrl', () => {
  it('leaves the query string out', () => {
    expect(describeUrl(URL_WITH_TOKEN)).toBe(
      'https://bucket.example.com/run-1/trace.zip'
    )
  })
})

describe('downloadTrace', () => {
  it('returns the body of an allowed https URL', async () => {
    const get = serving(response(200, { chunks: [[1, 2], [3]] }))
    expect(await downloadTrace(URL_WITH_TOKEN, LIMITS, get)).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })

  it('follows a redirect to another allowed host', async () => {
    const get = serving(
      response(302, { location: 'https://cdn.example.com/trace.zip' }),
      response(200, { chunks: [[7]] })
    )
    expect(await downloadTrace(URL_WITH_TOKEN, LIMITS, get)).toEqual(
      new Uint8Array([7])
    )
    expect(get.urls[1]).toBe('https://cdn.example.com/trace.zip')
  })

  it('resolves a relative redirect against the URL it came from', async () => {
    const get = serving(
      response(307, { location: '/moved/trace.zip' }),
      response(200, { chunks: [[1]] })
    )
    await downloadTrace(URL_WITH_TOKEN, LIMITS, get)
    expect(get.urls[1]).toBe('https://bucket.example.com/moved/trace.zip')
  })

  it('refuses a redirect to a host that is not allowed', async () => {
    const get = serving(
      response(302, { location: 'https://evil.example.net/x.zip' })
    )
    await expect(downloadTrace(URL_WITH_TOKEN, LIMITS, get)).rejects.toThrow(
      'evil.example.net is not an allowed host'
    )
  })

  it('refuses a redirect down to http', async () => {
    const get = serving(
      response(301, { location: 'http://bucket.example.com/trace.zip' })
    )
    await expect(downloadTrace(URL_WITH_TOKEN, LIMITS, get)).rejects.toThrow(
      'only https URLs are fetched'
    )
  })

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const loop = Array.from({ length: MAX_REDIRECTS + 1 }, () =>
      response(302, { location: '/again' })
    )
    await expect(
      downloadTrace(URL_WITH_TOKEN, LIMITS, serving(...loop))
    ).rejects.toThrow(`more than ${MAX_REDIRECTS} redirects`)
  })

  it('refuses a redirect with no location', async () => {
    await expect(
      downloadTrace(URL_WITH_TOKEN, LIMITS, serving(response(302)))
    ).rejects.toThrow('a redirect named no location')
  })

  it('reports a status other than 200 without the query string', async () => {
    const failure = downloadTrace(
      URL_WITH_TOKEN,
      LIMITS,
      serving(response(403))
    )
    await expect(failure).rejects.toThrow(
      'Cannot download https://bucket.example.com/run-1/trace.zip: HTTP 403'
    )
    await expect(failure).rejects.not.toThrow('secret')
  })

  it('refuses a body its content-length declares too large, unread', async () => {
    const big = response(200, { contentLength: 11, chunks: [[1]] })
    await expect(
      downloadTrace(URL_WITH_TOKEN, LIMITS, serving(big))
    ).rejects.toThrow('larger than the 10-byte limit')
    expect(big.discard).toHaveBeenCalled()
  })

  it('stops reading a body that grows past the limit', async () => {
    const big = response(200, {
      chunks: [
        [1, 2, 3, 4, 5, 6],
        [7, 8, 9, 10, 11]
      ]
    })
    await expect(
      downloadTrace(URL_WITH_TOKEN, LIMITS, serving(big))
    ).rejects.toThrow('larger than the 10-byte limit')
    expect(big.discard).toHaveBeenCalled()
  })

  it('refuses every URL when no host is allowed', async () => {
    await expect(
      downloadTrace(
        URL_WITH_TOKEN,
        { allowedHosts: [], allowPrivateNetwork: false, maxZipBytes: 10 },
        serving(response(200))
      )
    ).rejects.toThrow('no allowed host is configured')
  })

  it('refuses a plain http URL before requesting it', async () => {
    const get = serving(response(200))
    await expect(
      downloadTrace(new URL('http://bucket.example.com/a.zip'), LIMITS, get)
    ).rejects.toThrow('only https URLs are fetched')
    expect(get.urls).toEqual([])
  })

  it.each([
    'https://127.0.0.1/trace.zip',
    'https://[::1]/trace.zip',
    'https://10.0.0.5/trace.zip'
  ])(
    'refuses the private IP literal %s before requesting it, even when listed',
    async (address) => {
      const url = new URL(address)
      const get = serving(response(200))
      await expect(
        downloadTrace(
          url,
          {
            ...LIMITS,
            allowedHosts: [url.hostname.replace(/^\[|\]$/g, ''), url.hostname]
          },
          get
        )
      ).rejects.toThrow('is a local or private address')
      expect(get.urls).toEqual([])
    }
  )

  it('fetches a listed private IP literal when the private network is allowed', async () => {
    const get = serving(response(200, { chunks: [[1]] }))
    await expect(
      downloadTrace(
        new URL('https://10.0.0.5/trace.zip'),
        { ...LIMITS, allowedHosts: ['10.0.0.5'], allowPrivateNetwork: true },
        get
      )
    ).resolves.toEqual(new Uint8Array([1]))
  })

  it('refuses a redirect to a private IP literal', async () => {
    const get = serving(response(302, { location: 'https://10.0.0.5/x.zip' }))
    await expect(
      downloadTrace(
        URL_WITH_TOKEN,
        { ...LIMITS, allowedHosts: [...LIMITS.allowedHosts, '10.0.0.5'] },
        get
      )
    ).rejects.toThrow('10.0.0.5 is a local or private address')
  })

  it('reassembles a body larger than its first buffer', async () => {
    const chunk = Array.from({ length: 6 }, (_, i) => i)
    const get = serving(response(200, { chunks: [chunk, chunk] }))
    await expect(
      downloadTrace(URL_WITH_TOKEN, { ...LIMITS, maxZipBytes: 100 }, get)
    ).resolves.toEqual(new Uint8Array([...chunk, ...chunk]))
  })

  it('fills a body into the length it declared', async () => {
    const get = serving(
      response(200, { contentLength: 3, chunks: [[1, 2], [3]] })
    )
    await expect(downloadTrace(URL_WITH_TOKEN, LIMITS, get)).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    )
  })
})
