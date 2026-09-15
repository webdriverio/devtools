import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  sessionEndpoint,
  webdriverExecute,
  webdriverGet,
  webdriverPost,
  type WebDriverAddress
} from '../src/webdriver-http.js'

type Received = {
  url?: string
  method?: string
  headers?: http.IncomingHttpHeaders
  body?: string
}

// A real driver rather than a mocked `http` module: the behaviours under test
// are all wire-level (a W3C error answered with 200, a malformed body, the
// auth header) and a mock would assert the mock.
let server: http.Server
let received: Received = {}
let respond: (res: http.ServerResponse) => void

const address = (): WebDriverAddress => ({
  hostname: '127.0.0.1',
  port: (server.address() as AddressInfo).port
})

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          received = {
            url: req.url,
            method: req.method,
            headers: req.headers,
            body
          }
          respond(res)
        })
      })
      server.listen(0, '127.0.0.1', () => resolve())
    })
)

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
)

const ok = (value: unknown) => (res: http.ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ value }))
}

describe('sessionEndpoint', () => {
  it('defaults to http and omits a root path prefix', () => {
    expect(
      sessionEndpoint({ hostname: 'h', port: 4723, path: '/' }, 'sess', 'url')
    ).toBe('http://h:4723/session/sess/url')
  })

  it('keeps a real base prefix and honours https', () => {
    expect(
      sessionEndpoint(
        { hostname: 'h', port: 443, path: '/wd/hub', protocol: 'https' },
        'sess',
        'title'
      )
    ).toBe('https://h:443/wd/hub/session/sess/title')
  })

  it('does not double the slash when the prefix carries a trailing one', () => {
    expect(
      sessionEndpoint({ hostname: 'h', port: 1, path: '/wd/hub/' }, 's', 'url')
    ).toBe('http://h:1/wd/hub/session/s/url')
  })
})

describe('webdriverGet', () => {
  it('resolves the W3C value field', async () => {
    respond = ok('https://example.com/')
    await expect(webdriverGet(address(), 'sess', 'url')).resolves.toBe(
      'https://example.com/'
    )
    expect(received.method).toBe('GET')
    expect(received.url).toBe('/session/sess/url')
  })

  // chromedriver answers some failures with a 200, so the shape is the signal.
  it('answers null for a W3C error payload delivered as 200', async () => {
    respond = ok({ error: 'no such window', message: 'gone', stacktrace: '' })
    await expect(webdriverGet(address(), 'sess', 'url')).resolves.toBeNull()
  })

  it('answers null for a body that is not JSON', async () => {
    respond = (res) => {
      res.writeHead(200)
      res.end('<html>gateway error</html>')
    }
    await expect(webdriverGet(address(), 'sess', 'url')).resolves.toBeNull()
  })

  it('answers null rather than throwing when the driver is unreachable', async () => {
    // Port 1 is not listening; a probe must never fail the user's test.
    await expect(
      webdriverGet({ hostname: '127.0.0.1', port: 1 }, 'sess', 'url')
    ).resolves.toBeNull()
  })

  it('reports a failure through the caller-supplied logger', async () => {
    const warnings: string[] = []
    await webdriverGet(
      { hostname: '127.0.0.1', port: 1, onWarn: (m) => warnings.push(m) },
      'sess',
      'url'
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Request failed')
  })
})

describe('webdriverPost', () => {
  it('sends a JSON body with a matching content-length', async () => {
    respond = ok(null)
    await webdriverPost(address(), 'sess', 'execute/sync', { script: 'x' })
    expect(received.method).toBe('POST')
    expect(received.body).toBe('{"script":"x"}')
    expect(received.headers?.['content-type']).toBe('application/json')
    expect(received.headers?.['content-length']).toBe(
      String(Buffer.byteLength('{"script":"x"}'))
    )
  })
})

describe('webdriverExecute', () => {
  it('posts the body as a script with empty args by default', async () => {
    respond = ok(42)
    await expect(
      webdriverExecute(address(), 'sess', 'return 41 + 1')
    ).resolves.toBe(42)
    expect(received.url).toBe('/session/sess/execute/sync')
    expect(JSON.parse(received.body ?? '{}')).toEqual({
      script: 'return 41 + 1',
      args: []
    })
  })
})

describe('authentication', () => {
  it('sends basic auth when both user and key are present', async () => {
    respond = ok('ok')
    const addr = { ...address(), user: 'u', key: 'k' }
    await webdriverGet(addr, 'sess', 'url')
    const expected = Buffer.from('u:k').toString('base64')
    expect(received.headers?.authorization).toBe(`Basic ${expected}`)
  })

  // Half a credential pair is not a credential; sending `Basic dTo=` would
  // turn a missing key into a 401 that reads as a wrong password.
  it('sends no auth header when only one half is present', async () => {
    respond = ok('ok')
    await webdriverGet({ ...address(), user: 'u' }, 'sess', 'url')
    expect(received.headers?.authorization).toBeUndefined()
  })
})

// A probe must never fail the user's test, and `http.request` throws
// SYNCHRONOUSLY on an endpoint it cannot parse — unguarded that rejects the
// promise rather than resolving null, and the rejection escapes into the
// command hook that issued the probe.
describe('an endpoint node cannot parse', () => {
  it('resolves null instead of rejecting', async () => {
    await expect(
      webdriverGet({ hostname: '::1', port: 4723 }, 'sess', 'url')
    ).resolves.toBeNull()
  })

  it('reports it through the caller-supplied logger', async () => {
    const warnings: string[] = []
    await webdriverGet(
      { hostname: '::1', port: 4723, onWarn: (m) => warnings.push(m) },
      'sess',
      'url'
    )
    expect(warnings.join('\n')).toMatch(/could not be issued|failed/i)
  })
})
