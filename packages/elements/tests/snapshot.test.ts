import { describe, it, expect } from 'vitest'
import {
  serializeWebSnapshot,
  serializeMobileSnapshot
} from '../src/snapshot.js'
import type { AccessibilityNode } from '../src/accessibility-tree.js'
import type { JSONElement } from '../src/locators/types.js'

// ---------------------------------------------------------------------------
// serializeWebSnapshot
// ---------------------------------------------------------------------------

function node(
  overrides: Partial<AccessibilityNode> & { role: string; depth: number }
): AccessibilityNode {
  return {
    name: '',
    selector: '',
    level: '',
    disabled: '',
    checked: '',
    expanded: '',
    selected: '',
    pressed: '',
    required: '',
    readonly: '',
    ...overrides
  }
}

describe('serializeWebSnapshot', () => {
  it('produces a page header', () => {
    const out = serializeWebSnapshot([])
    expect(out).toBe('[Page]')
  })

  it('includes title and url in header', () => {
    const out = serializeWebSnapshot([], {
      title: 'Login',
      url: 'https://example.com/login'
    })
    expect(out).toMatch('[Page: Login — https://example.com/login]')
  })

  it('renders interactive role with name and selector', () => {
    const nodes = [
      node({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit'
      })
    ]
    const out = serializeWebSnapshot(nodes)
    expect(out).toContain('button "Submit"  →  button*=Submit')
  })

  it('renders interactive role with ∈ ancestor name when self has no name', () => {
    const nodes = [
      node({ role: 'form', depth: 0, name: 'Login form' }),
      node({ role: 'checkbox', depth: 1, name: '', selector: '#remember' })
    ]
    const out = serializeWebSnapshot(nodes)
    expect(out).toContain('checkbox ∈ "Login form"  →  #remember')
  })

  it('omits interactive node with no selector regardless of name', () => {
    const nodes = [
      node({ role: 'button', depth: 0, name: '', selector: '' }),
      node({
        role: 'button',
        depth: 0,
        name: 'Named but unselector',
        selector: ''
      })
    ]
    const out = serializeWebSnapshot(nodes)
    // Only the header — both nodes skipped due to missing selector
    expect(out.split('\n').length).toBe(1)
  })

  it('omits interactive node with ∈ context but no selector', () => {
    const nodes = [
      node({ role: 'form', depth: 0, name: 'Login form' }),
      node({ role: 'combobox', depth: 1, name: '', selector: '' })
    ]
    const out = serializeWebSnapshot(nodes)
    // combobox has ancestor context but no selector — must be dropped
    expect(out).not.toContain('combobox')
    expect(out).not.toContain('→')
  })

  it('renders container role without selector', () => {
    const nodes = [node({ role: 'navigation', depth: 0, name: 'Main' })]
    const out = serializeWebSnapshot(nodes)
    expect(out).toContain('navigation "Main"')
    expect(out).not.toContain('→')
  })

  it('renders heading with level suffix', () => {
    const nodes = [
      node({ role: 'heading', depth: 0, name: 'Sign in', level: 1 })
    ]
    const out = serializeWebSnapshot(nodes)
    expect(out).toContain('heading[1] "Sign in"')
  })

  it('indents nodes according to depth', () => {
    const nodes = [
      node({ role: 'navigation', depth: 0, name: 'Nav' }),
      node({ role: 'link', depth: 1, name: 'Home', selector: 'a*=Home' })
    ]
    const lines = serializeWebSnapshot(nodes).split('\n')
    // depth 0 → 1 level of indent ('  ' × 1), depth 1 → 2 levels ('  ' × 2)
    expect(lines[1]).toMatch(/^  navigation/)
    expect(lines[2]).toMatch(/^    link/)
  })

  it('renders full login page example correctly', () => {
    const nodes: AccessibilityNode[] = [
      node({ role: 'navigation', depth: 0, name: 'Main' }),
      node({ role: 'link', depth: 1, name: 'Home', selector: 'a*=Home' }),
      node({ role: 'main', depth: 0, name: '' }),
      node({ role: 'heading', depth: 1, name: 'Sign in', level: 1 }),
      node({ role: 'form', depth: 1, name: 'Login' }),
      node({
        role: 'textbox',
        depth: 2,
        name: 'Email address',
        selector: '#email'
      }),
      node({
        role: 'button',
        depth: 2,
        name: 'Sign in',
        selector: 'button*=Sign in'
      })
    ]
    const out = serializeWebSnapshot(nodes, {
      title: 'Login',
      url: 'https://example.com/login'
    })
    expect(out).toContain('[Page: Login — https://example.com/login]')
    expect(out).toContain('navigation "Main"')
    expect(out).toContain('link "Home"  →  a*=Home')
    expect(out).toContain('heading[1] "Sign in"')
    expect(out).toContain('textbox "Email address"  →  #email')
    expect(out).toContain('button "Sign in"  →  button*=Sign in')
  })
})

// ---------------------------------------------------------------------------
// serializeMobileSnapshot
// ---------------------------------------------------------------------------

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
    expect(out).toContain('Button "Skip"  →  accessibility-id:Skip')
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
    expect(out).toContain('EditText  →  id:com.example:id/search')
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
      'EditText ∈ "Search section"  →  id:com.example:id/search'
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
    expect(out).toContain(
      'Button "Accept All Cookies"  →  accessibility-id:Accept All Cookies'
    )
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
