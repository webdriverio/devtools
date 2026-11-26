import { describe, expect, it, vi } from 'vitest'

import { serializeMobileSnapshot } from '../src/element-snapshot.js'
import { generateAllElementLocators } from '../src/locators/index.js'
import type * as LocatorGeneration from '../src/locators/locator-generation.js'
import { getSuggestedLocators } from '../src/locators/locator-generation.js'
import type { JSONElement } from '../src/locators/types.js'
import { xmlToJSON } from '../src/locators/xml-parsing.js'

vi.mock('../src/locators/locator-generation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof LocatorGeneration>()
  return { ...actual, getSuggestedLocators: vi.fn(actual.getSuggestedLocators) }
})

function mobileEl(
  tagName: string,
  attrs: JSONElement['attributes'],
  children: JSONElement[] = []
): JSONElement {
  return { tagName, attributes: attrs, children, path: '' }
}

describe('serializeMobileSnapshot', () => {
  it('produces a platform header with device and viewport', () => {
    const root = mobileEl('hierarchy', {})
    const out = serializeMobileSnapshot(root, {
      platform: 'android',
      deviceName: 'Pixel 7',
      viewport: { width: 412, height: 915 }
    })
    expect(out).toMatch('[android — Pixel 7 (412×915)]')
  })

  it('renders interactive Android element with accessibility-id locator', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl('android.widget.Button', {
        clickable: 'true',
        'content-desc': 'Skip',
        text: ''
      })
    ])
    const out = serializeMobileSnapshot(root, { platform: 'android' })
    expect(out).toContain('button "Skip"  →  ~Skip')
  })

  it('falls back to resource-id when no content-desc', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl('android.widget.EditText', {
        clickable: 'true',
        'content-desc': '',
        'resource-id': 'com.example:id/search',
        text: ''
      })
    ])
    const out = serializeMobileSnapshot(root, { platform: 'android' })
    expect(out).toContain('textbox "search"  →  id:com.example:id/search')
  })

  it('renders ∈ ancestor context when element has no identity', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl(
        'android.widget.LinearLayout',
        { 'content-desc': 'Search section' },
        [
          mobileEl('android.widget.EditText', {
            clickable: 'true',
            'content-desc': '',
            'resource-id': 'com.example:id/search',
            text: ''
          })
        ]
      )
    ])
    const out = serializeMobileSnapshot(root, { platform: 'android' })
    expect(out).toContain(
      'textbox "search" ∈ "Search section"  →  id:com.example:id/search'
    )
  })

  it('renders iOS element with accessibility-id', () => {
    const root = mobileEl('XCUIElementTypeApplication', {}, [
      mobileEl('XCUIElementTypeButton', {
        accessible: 'true',
        name: 'Accept All Cookies',
        label: 'Accept All Cookies'
      })
    ])
    const out = serializeMobileSnapshot(root, { platform: 'ios' })
    expect(out).toContain('button "Accept All Cookies"  →  ~Accept All Cookies')
  })

  it('simplifies iOS XCUIElementType prefix', () => {
    const root = mobileEl('XCUIElementTypeApplication', {}, [
      mobileEl('XCUIElementTypeScrollView', {})
    ])
    const out = serializeMobileSnapshot(root, { platform: 'ios' })
    expect(out).toContain('ScrollView')
    expect(out).not.toContain('XCUIElementType')
  })

  it('shows container without selector', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl('android.widget.FrameLayout', { 'content-desc': '' })
    ])
    const out = serializeMobileSnapshot(root, { platform: 'android' })
    expect(out).toContain('FrameLayout')
    expect(out).not.toContain('→')
  })
})

describe('serializeMobileSnapshot with stamped selectors', () => {
  const IOS_XML =
    '<XCUIElementTypeApplication name="App" x="0" y="0" width="390" height="844"><XCUIElementTypeWindow x="0" y="0" width="390" height="844"><XCUIElementTypeButton name="Accept All Cookies" label="Accept All Cookies" enabled="true" visible="true" accessible="true" x="10" y="20" width="200" height="44"/><XCUIElementTypeButton name="Tom &amp; Jerry" label="Tom &amp; Jerry" enabled="true" visible="true" accessible="true" x="10" y="80" width="200" height="44"/></XCUIElementTypeWindow></XCUIElementTypeApplication>'

  it('renders the same snapshot without recomputing stamped locators', () => {
    const unstamped = serializeMobileSnapshot(xmlToJSON(IOS_XML)!, {
      platform: 'ios',
      sourceXML: IOS_XML
    })

    const stamped = xmlToJSON(IOS_XML)!
    generateAllElementLocators(IOS_XML, {
      platform: 'ios',
      inViewportOnly: false,
      tree: stamped
    })
    vi.mocked(getSuggestedLocators).mockClear()
    const out = serializeMobileSnapshot(stamped, {
      platform: 'ios',
      sourceXML: IOS_XML
    })

    expect(getSuggestedLocators).not.toHaveBeenCalled()
    expect(out).toBe(unstamped)
    expect(out).toContain('~Tom & Jerry')
  })

  it('recomputes locators when the tree was not stamped', () => {
    vi.mocked(getSuggestedLocators).mockClear()
    serializeMobileSnapshot(xmlToJSON(IOS_XML)!, {
      platform: 'ios',
      sourceXML: IOS_XML
    })
    expect(getSuggestedLocators).toHaveBeenCalled()
  })
})
