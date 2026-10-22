import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, execute } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  execute: vi.fn()
}))

vi.mock('@wdio/logger', () => ({ default: vi.fn(() => mockLogger) }))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  webdriverExecute: execute
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

const ENTRY = {
  url: 'https://api.example.com/items',
  method: 'GET',
  statusCode: 200
}
const START = ['interceptor: startListening', [{}]]

describe('InterceptedNetwork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execute.mockReset()
  })

  it('starts a listener over raw WebDriver HTTP for a native session that asked for the proxy', async () => {
    execute.mockResolvedValueOnce('L1')
    await new InterceptedNetwork(REQUESTED, capturer()).start(browser())
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: '127.0.0.1', port: 4723 }),
      'sess',
      ...START
    )
  })

  it('stays off when the session did not ask for the proxy', async () => {
    await new InterceptedNetwork(NATIVE_CAPS, capturer()).start(browser())
    const notTrue = { ...NATIVE_CAPS, 'appium:intercept': 'yes' }
    await new InterceptedNetwork(notTrue, capturer()).start(browser())
    expect(execute).not.toHaveBeenCalled()
  })

  it('stays off when there is no browser to start on', async () => {
    await new InterceptedNetwork(REQUESTED, capturer()).start(undefined)
    expect(execute).not.toHaveBeenCalled()
  })

  it('stays off for a session with a document, whose network the page already captures', async () => {
    const web = browser({
      capabilities: { platformName: 'Android', browserName: 'chrome' }
    })
    await new InterceptedNetwork(REQUESTED, capturer()).start(web)
    expect(execute).not.toHaveBeenCalled()
  })

  it('warns and stays off when the driver address is not knowable', async () => {
    await new InterceptedNetwork(REQUESTED, capturer()).start(
      browser({ options: {} })
    )
    expect(execute).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('address is not knowable')
    )
  })

  it('warns and forwards nothing when the plugin does not answer', async () => {
    execute.mockResolvedValueOnce(null)
    const target = capturer()
    const network = new InterceptedNetwork(REQUESTED, target)
    await network.start(browser())
    await network.forward()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('appium-interceptor')
    )
    expect(execute).toHaveBeenCalledTimes(1)
    expect(target.recordNetworkRequests).not.toHaveBeenCalled()
  })

  it('records and streams the rows a drain returns, and nothing for an empty one', async () => {
    execute
      .mockResolvedValueOnce('L1')
      .mockResolvedValueOnce([ENTRY])
      .mockResolvedValueOnce([ENTRY])
    const target = capturer()
    const network = new InterceptedNetwork(REQUESTED, target)
    await network.start(browser())
    await network.forward()
    await network.forward()
    expect(target.recordNetworkRequests).toHaveBeenCalledTimes(1)
    expect(target.recordNetworkRequests).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'interceptor-L1-0', url: ENTRY.url })
    ])
  })

  it('starts a fresh listener for a reloaded session and drops the old one', async () => {
    execute.mockResolvedValueOnce('L1').mockResolvedValueOnce(null)
    const network = new InterceptedNetwork(REQUESTED, capturer())
    await network.start(browser())
    await network.start(browser({ sessionId: 'sess-2' }))
    expect(execute).toHaveBeenLastCalledWith(
      expect.anything(),
      'sess-2',
      ...START
    )
    await network.forward()
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
