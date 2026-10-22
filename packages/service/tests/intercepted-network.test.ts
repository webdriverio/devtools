import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, poller } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  poller: { start: vi.fn(), drain: vi.fn(), args: [] as unknown[] }
}))

vi.mock('@wdio/logger', () => ({ default: vi.fn(() => mockLogger) }))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  InterceptorNetworkPoller: class {
    constructor(...args: unknown[]) {
      poller.args = args
    }
    start = poller.start
    drain = poller.drain
  }
}))

import { InterceptedNetwork } from '../src/intercepted-network.js'
import type { SessionCapturer } from '../src/session.js'

const NATIVE_CAPS = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}
const REQUESTED = { ...NATIVE_CAPS, 'appium:intercept': true }

const browser = (over: Record<string, unknown> = {}) =>
  ({
    sessionId: 'sess',
    capabilities: NATIVE_CAPS,
    options: { hostname: '127.0.0.1', port: 4723, path: '/' },
    ...over
  }) as unknown as WebdriverIO.Browser

const capturer = () =>
  ({
    recordNetworkRequests: vi.fn()
  }) as unknown as SessionCapturer & {
    recordNetworkRequests: ReturnType<typeof vi.fn>
  }

describe('InterceptedNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poller.args = []
  })

  it('starts a listener for a native session that asked for the proxy', async () => {
    poller.start.mockResolvedValueOnce(true)
    await new InterceptedNetwork(REQUESTED, capturer()).start(browser())
    expect(poller.start).toHaveBeenCalledTimes(1)
    expect(poller.args[0]).toMatchObject({ hostname: '127.0.0.1', port: 4723 })
    expect(poller.args[1]).toBe('sess')
  })

  it('stays off when the session did not ask for the proxy', async () => {
    await new InterceptedNetwork(NATIVE_CAPS, capturer()).start(browser())
    await new InterceptedNetwork(
      { ...NATIVE_CAPS, 'appium:intercept': 'yes' },
      capturer()
    ).start(browser())
    expect(poller.start).not.toHaveBeenCalled()
  })

  it('stays off when there is no browser to start on', async () => {
    await new InterceptedNetwork(REQUESTED, capturer()).start(undefined)
    expect(poller.start).not.toHaveBeenCalled()
  })

  it('stays off for a session with a document, whose network the page already captures', async () => {
    const web = browser({
      capabilities: { platformName: 'Android', browserName: 'chrome' }
    })
    await new InterceptedNetwork(REQUESTED, capturer()).start(web)
    expect(poller.start).not.toHaveBeenCalled()
  })

  it('warns and stays off when the driver address is not knowable', async () => {
    await new InterceptedNetwork(REQUESTED, capturer()).start(
      browser({ options: {} })
    )
    expect(poller.start).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('address is not knowable')
    )
  })

  it('warns and forwards nothing when the plugin does not answer', async () => {
    poller.start.mockResolvedValueOnce(false)
    const target = capturer()
    const network = new InterceptedNetwork(REQUESTED, target)
    await network.start(browser())
    await network.forward()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('appium-interceptor')
    )
    expect(poller.drain).not.toHaveBeenCalled()
    expect(target.recordNetworkRequests).not.toHaveBeenCalled()
  })

  it('records and streams the rows a drain returns, and nothing for an empty one', async () => {
    poller.start.mockResolvedValueOnce(true)
    const rows = [{ id: 'interceptor-L1-0' }]
    poller.drain.mockResolvedValueOnce(rows).mockResolvedValueOnce([])
    const target = capturer()
    const network = new InterceptedNetwork(REQUESTED, target)
    await network.start(browser())
    await network.forward()
    await network.forward()
    expect(target.recordNetworkRequests).toHaveBeenCalledTimes(1)
    expect(target.recordNetworkRequests).toHaveBeenCalledWith(rows)
  })

  it('starts a fresh listener for a reloaded session and drops the old one', async () => {
    poller.start.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const network = new InterceptedNetwork(REQUESTED, capturer())
    await network.start(browser())
    await network.start(browser({ sessionId: 'sess-2' }))
    expect(poller.args[1]).toBe('sess-2')
    await network.forward()
    expect(poller.drain).not.toHaveBeenCalled()
  })
})
