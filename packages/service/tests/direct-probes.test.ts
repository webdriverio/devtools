import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolveWebDriverAddress } from '../src/webdriver-address.js'
import { directProbes } from '../src/direct-probes.js'
import { captureActionSnapshot } from '../src/action-snapshot.js'

// Double cast: `WebdriverIO.Browser` carries private fields no stub can
// satisfy, and these probes read only sessionId/options/capabilities.
const browser = (over: Record<string, unknown> = {}): WebdriverIO.Browser =>
  ({
    sessionId: 'sess',
    isMobile: true,
    options: { hostname: '127.0.0.1', port: 4723, path: '/' },
    ...over
  }) as unknown as WebdriverIO.Browser

describe('resolveWebDriverAddress', () => {
  it('reads the connection options WDIO built the session with', () => {
    const address = resolveWebDriverAddress(
      browser({
        options: {
          protocol: 'https',
          hostname: 'hub.example.com',
          port: 443,
          path: '/wd/hub',
          user: 'u',
          key: 'k'
        }
      })
    )
    expect(address).toMatchObject({
      protocol: 'https',
      hostname: 'hub.example.com',
      port: 443,
      path: '/wd/hub',
      user: 'u',
      key: 'k'
    })
  })

  // Guessing localhost would aim a probe at whatever else is listening there.
  it('answers undefined when the address is not knowable', () => {
    expect(resolveWebDriverAddress(browser({ options: {} }))).toBeUndefined()
    expect(
      resolveWebDriverAddress(browser({ options: { hostname: 'h' } }))
    ).toBeUndefined()
    expect(
      resolveWebDriverAddress(browser({ options: { port: 4723 } }))
    ).toBeUndefined()
  })
})

describe('directProbes', () => {
  it('serves an Appium session, which is the one that deadlocks', () => {
    expect(directProbes(browser())).toBeDefined()
  })

  // Desktop chromedriver tolerates the re-entrancy, and `browser.*` carries
  // WDIO's own retries — so it stays the path wherever it works.
  it('declines a desktop session', () => {
    expect(
      directProbes(browser({ isMobile: false, isAndroid: false, isIOS: false }))
    ).toBeUndefined()
  })

  it('declines when the driver address is unknown', () => {
    expect(directProbes(browser({ options: {} }))).toBeUndefined()
  })

  it('declines before a session exists', () => {
    expect(directProbes(browser({ sessionId: undefined }))).toBeUndefined()
  })

  it('exposes the four probes beforeCommand issues', () => {
    const probes = directProbes(browser())
    expect(Object.keys(probes ?? {}).sort()).toEqual([
      'getPageSource',
      'getTitle',
      'getUrl',
      'runScript',
      'takeScreenshot'
    ])
  })
})

// The regression #374 exists for: these probes are issued from inside
// `beforeCommand`, and on Appium a `browser.*` call there enqueues behind the
// command it is observing and never resolves. Asserting the TRANSPORT rather
// than a timeout keeps the test fast and deterministic.
describe('captureActionSnapshot on an Appium session (#374)', () => {
  let server: http.Server
  const seen: string[] = []

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          seen.push(`${req.method} ${req.url}`)
          req.on('data', () => {})
          req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ value: null }))
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

  it('reaches the driver directly and never through browser.*', async () => {
    const forbidden = (name: string) => () => {
      throw new Error(`browser.${name} must not be called from the hook`)
    }
    const appium = browser({
      options: {
        hostname: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        path: '/'
      },
      capabilities: { platformName: 'Android', browserName: 'chrome' },
      execute: forbidden('execute'),
      getUrl: forbidden('getUrl'),
      getTitle: forbidden('getTitle'),
      takeScreenshot: forbidden('takeScreenshot')
    })

    await expect(
      captureActionSnapshot(appium, 'click', 1)
    ).resolves.not.toThrow()
    expect(seen.some((r) => r.includes('execute/sync'))).toBe(true)
  })
})
