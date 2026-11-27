import { describe, expect, it, vi } from 'vitest'

import { nativeSnapshotFromPageSource } from '../src/native-snapshot.js'

const IOS_SOURCE =
  '<AppiumAUT><XCUIElementTypeApplication name="Settings" x="0" y="0" width="390" height="844">' +
  '<XCUIElementTypeButton name="General" label="General" enabled="true" visible="true" accessible="true" x="16" y="200" width="358" height="44"/>' +
  '</XCUIElementTypeApplication></AppiumAUT>'

const ANDROID_SOURCE =
  '<hierarchy><android.widget.FrameLayout bounds="[0,0][1080,2400]">' +
  '<android.widget.Button resource-id="com.app:id/start" text="Start" clickable="true" enabled="true" displayed="true" bounds="[100,200][300,400]"/>' +
  '</android.widget.FrameLayout></hierarchy>'

describe('nativeSnapshotFromPageSource', () => {
  it('turns an iOS page source into A11y text and located elements', () => {
    const native = nativeSnapshotFromPageSource(IOS_SOURCE, 'ios')

    expect(native?.snapshotText.split('\n')[0]).toBe('[ios]')
    expect(native?.snapshotText).toContain('"General"')
    expect(native?.elements.length).toBeGreaterThan(0)
  })

  it('turns an Android page source into A11y text and located elements', () => {
    const native = nativeSnapshotFromPageSource(ANDROID_SOURCE, 'android')

    expect(native?.snapshotText.split('\n')[0]).toBe('[android]')
    expect(native?.snapshotText).toContain('com.app:id/start')
    expect(native?.elements.length).toBeGreaterThan(0)
  })

  it('reads nothing from a webview HTML source', () => {
    expect(
      nativeSnapshotFromPageSource('<!DOCTYPE html><html></html>', 'ios')
    ).toBeUndefined()
  })

  it('keeps the A11y text when the page source does not parse', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const native = nativeSnapshotFromPageSource('not xml', 'android')
    errors.mockRestore()

    expect(native?.snapshotText).toBe('[android]')
    expect(native?.elements).toEqual([])
  })
})
