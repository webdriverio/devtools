import { describe, expect, it, vi, beforeEach } from 'vitest'

// The read has to bypass Nightwatch's command queue, so the adapter goes over
// the raw WebDriver transport — mocked here to assert both the geometry and
// that the queue is never touched.
const webdriverExecute = vi.fn()
const webdriverGet = vi.fn()
vi.mock('../src/helpers/webdriverHttp.js', () => ({
  webdriverExecute: (...args: unknown[]) => webdriverExecute(...args),
  webdriverGet: (...args: unknown[]) => webdriverGet(...args),
  webdriverPost: vi.fn(),
  resolveWebDriverAddress: vi.fn()
}))

const { resolveViewport } = await import('@wdio/devtools-core')

const WEB_CAPS = { browserName: 'chrome' }
const NATIVE_CAPS = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}

/** The adapter's own probe wiring, mirrored so the transport choice is what is
 *  under test rather than the surrounding session bringup. */
function readViewport(capabilities: Record<string, unknown>) {
  return resolveViewport(capabilities, {
    runScript: (body: string) => webdriverExecute(body),
    getWindowSize: () => webdriverGet('window/rect')
  })
}

beforeEach(() => {
  webdriverExecute.mockReset()
  webdriverGet.mockReset()
})

describe('nightwatch viewport metadata (#373)', () => {
  it('reads the page viewport over the raw transport', async () => {
    webdriverExecute.mockResolvedValue({
      width: 1440,
      height: 778,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    await expect(readViewport(WEB_CAPS)).resolves.toEqual({
      width: 1440,
      height: 778,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    expect(webdriverExecute).toHaveBeenCalledOnce()
    expect(webdriverGet).not.toHaveBeenCalled()
  })

  it('asks the device window on a native session', async () => {
    webdriverGet.mockResolvedValue({ width: 1080, height: 2219 })
    await expect(readViewport(NATIVE_CAPS)).resolves.toEqual({
      width: 1080,
      height: 2219,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    expect(webdriverGet).toHaveBeenCalledWith('window/rect')
    expect(webdriverExecute).not.toHaveBeenCalled()
  })

  // The transport answers null for any failure rather than rejecting.
  it('answers undefined when the transport returns null', async () => {
    webdriverExecute.mockResolvedValue(null)
    await expect(readViewport(WEB_CAPS)).resolves.toBeUndefined()
  })
})
