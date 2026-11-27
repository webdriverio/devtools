import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as Locators from '../src/locators/index.js'
import type * as MobileSnapshot from '../src/mobile-snapshot.js'

const failures = vi.hoisted(() => ({ serialize: false, locate: false }))

vi.mock('../src/mobile-snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MobileSnapshot>()
  return {
    ...actual,
    serializeMobileSnapshot: (
      ...args: Parameters<typeof actual.serializeMobileSnapshot>
    ) => {
      if (failures.serialize) {
        throw new Error('serializer broke')
      }
      return actual.serializeMobileSnapshot(...args)
    }
  }
})

vi.mock('../src/locators/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Locators>()
  return {
    ...actual,
    generateAllElementLocators: (
      ...args: Parameters<typeof actual.generateAllElementLocators>
    ) => {
      if (failures.locate) {
        throw new Error('locators broke')
      }
      return actual.generateAllElementLocators(...args)
    }
  }
})

const { nativeSnapshotFromPageSource } =
  await import('../src/native-snapshot.js')

const IOS_SOURCE =
  '<AppiumAUT><XCUIElementTypeApplication name="Settings" x="0" y="0" width="390" height="844">' +
  '<XCUIElementTypeButton name="General" label="General" enabled="true" visible="true" accessible="true" x="16" y="200" width="358" height="44"/>' +
  '</XCUIElementTypeApplication></AppiumAUT>'

describe('nativeSnapshotFromPageSource when a transform throws', () => {
  afterEach(() => {
    failures.serialize = false
    failures.locate = false
    vi.restoreAllMocks()
  })

  it('returns nothing and warns when the text cannot be serialized, so the capture keeps its screenshot', () => {
    failures.serialize = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(nativeSnapshotFromPageSource(IOS_SOURCE, 'ios')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('serializer broke')
    )
  })

  it('keeps the text and drops only the element list when locator generation fails', () => {
    failures.locate = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const native = nativeSnapshotFromPageSource(IOS_SOURCE, 'ios')

    expect(native?.snapshotText).toContain('"General"')
    expect(native?.elements).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('locators broke'))
  })
})
