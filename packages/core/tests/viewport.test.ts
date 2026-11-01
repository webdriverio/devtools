import { describe, it, expect, vi } from 'vitest'
import { resolveViewport, VISUAL_VIEWPORT_SCRIPT } from '../src/viewport.js'

const WEB = { browserName: 'chrome', platformName: 'linux' }
const NATIVE = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}

describe('resolveViewport on a page', () => {
  it('reads the visual viewport, keeping scale and offsets', async () => {
    const runScript = vi.fn().mockResolvedValue({
      width: 390,
      height: 664,
      offsetLeft: 0,
      offsetTop: 12,
      scale: 2
    })
    await expect(resolveViewport(WEB, { runScript })).resolves.toEqual({
      width: 390,
      height: 664,
      offsetLeft: 0,
      offsetTop: 12,
      scale: 2
    })
    expect(runScript).toHaveBeenCalledWith(VISUAL_VIEWPORT_SCRIPT)
  })

  it('defaults scale and offsets when the page omits them', async () => {
    const runScript = vi.fn().mockResolvedValue({ width: 1280, height: 720 })
    await expect(resolveViewport(WEB, { runScript })).resolves.toEqual({
      width: 1280,
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
  })

  // A driver that structurally serializes the host object hands back `{}`,
  // which must read as "no viewport" rather than a zero-sized one.
  it('answers undefined for an empty or sizeless read', async () => {
    for (const value of [{}, null, undefined, { width: 0, height: 0 }]) {
      const runScript = vi.fn().mockResolvedValue(value)
      await expect(resolveViewport(WEB, { runScript })).resolves.toBeUndefined()
    }
  })

  it('never asks the device window for a page', async () => {
    const getWindowSize = vi.fn()
    await resolveViewport(WEB, {
      runScript: vi.fn().mockResolvedValue({ width: 1, height: 1 }),
      getWindowSize
    })
    expect(getWindowSize).not.toHaveBeenCalled()
  })
})

describe('resolveViewport on a native session', () => {
  it('measures the device window instead of a page', async () => {
    const runScript = vi.fn()
    const getWindowSize = vi
      .fn()
      .mockResolvedValue({ width: 1080, height: 2219 })
    await expect(
      resolveViewport(NATIVE, { runScript, getWindowSize })
    ).resolves.toEqual({
      width: 1080,
      height: 2219,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    // A native app has no document; the page read can only fail there.
    expect(runScript).not.toHaveBeenCalled()
  })

  it('answers undefined when the window cannot be measured', async () => {
    const getWindowSize = vi.fn().mockResolvedValue(undefined)
    await expect(
      resolveViewport(NATIVE, { getWindowSize })
    ).resolves.toBeUndefined()
  })
})

describe('resolveViewport degradation', () => {
  // The geometry is worth having, but not at the cost of the session.
  it('warns and answers undefined rather than throwing', async () => {
    const onWarn = vi.fn()
    const runScript = vi.fn().mockRejectedValue(new Error('no such window'))
    await expect(
      resolveViewport(WEB, { runScript, onWarn })
    ).resolves.toBeUndefined()
    expect(onWarn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve the session viewport')
    )
  })

  it('answers undefined when the adapter supplies no probe', async () => {
    await expect(resolveViewport(WEB, {})).resolves.toBeUndefined()
    await expect(resolveViewport(NATIVE, {})).resolves.toBeUndefined()
  })
})
