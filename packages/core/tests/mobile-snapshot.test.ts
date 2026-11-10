import { describe, expect, it } from 'vitest'

import { serializeMobileSnapshot } from '../src/element-snapshot.js'
import type { JSONElement } from '../src/locators/types.js'

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
