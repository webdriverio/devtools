import { describe, it, expect } from 'vitest'
import {
  serializeWebSnapshot,
  serializeMobileSnapshot,
  buildSnapshot,
  accessibilityNodesToSnapshotNodes,
  jsonElementToSnapshotNodes
} from '../src/snapshot.js'
import type { AccessibilityNode } from '../src/accessibility-tree.js'
import type { JSONElement } from '../src/locators/types.js'
import type { SnapshotNode } from '@wdio/devtools-core/element-types'

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
    expect(out).toContain('link "Home" ∈ "Main"  →  a*=Home')
    expect(out).toContain('heading[1] "Sign in"')
    expect(out).toContain('textbox "Email address" ∈ "Login"  →  #email')
    expect(out).toContain('button "Sign in" ∈ "Login"  →  button*=Sign in')
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

// ---------------------------------------------------------------------------
// buildSnapshot
// ---------------------------------------------------------------------------

function snapNode(overrides: Partial<SnapshotNode>): SnapshotNode {
  return {
    role: 'button',
    name: '',
    selector: '',
    depth: 0,
    isInteractive: false,
    tagName: 'button',
    ...overrides
  }
}

describe('buildSnapshot', () => {
  it('returns empty elements map for empty nodes', () => {
    const result = buildSnapshot('[Page]', [])
    expect(result.text).toBe('[Page]')
    expect(result.elements).toEqual({})
  })

  it('renders structural nodes without eN IDs', () => {
    const nodes = [
      snapNode({
        role: 'navigation',
        depth: 0,
        name: 'Main',
        isInteractive: false,
        tagName: 'nav'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('navigation "Main"')
    expect(result.text).not.toContain('e1')
    expect(result.text).not.toContain('→')
    expect(result.elements).toEqual({})
  })

  it('assigns e1 to first interactive element', () => {
    const nodes = [
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit',
        isInteractive: true,
        tagName: 'button'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('e1  button "Submit"  →  button*=Submit')
    expect(result.elements).toEqual({
      e1: {
        selector: 'button*=Submit',
        tagName: 'button',
        role: 'button',
        text: 'Submit'
      }
    })
  })

  it('skips eN for non-interactive nodes and continues numbering', () => {
    const nodes = [
      snapNode({
        role: 'navigation',
        depth: 0,
        name: 'Nav',
        isInteractive: false,
        tagName: 'nav'
      }),
      snapNode({
        role: 'link',
        depth: 1,
        name: 'Home',
        selector: 'a*=Home',
        isInteractive: true,
        tagName: 'a'
      }),
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit',
        isInteractive: true,
        tagName: 'button'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('navigation "Nav"')
    // link at depth 1 has "Nav" as its structural ancestor → ∈ context
    expect(result.text).toContain('e1  link "Home" ∈ "Nav"  →  a*=Home')
    // button at depth 0 also gets ∈ "Nav" — Nav is a same-depth structural sibling
    expect(result.text).toContain(
      'e2  button "Submit" ∈ "Nav"  →  button*=Submit'
    )
    expect(Object.keys(result.elements)).toEqual(['e1', 'e2'])
  })

  it('renders heading with level suffix', () => {
    const nodes = [
      snapNode({
        role: 'heading',
        depth: 0,
        name: 'Welcome',
        level: 2,
        isInteractive: false,
        tagName: 'h2'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('heading[2] "Welcome"')
  })

  it('renders ∈ ancestor context for interactive nodes', () => {
    const nodes = [
      snapNode({
        role: 'form',
        depth: 0,
        name: 'Login',
        isInteractive: false,
        tagName: 'form'
      }),
      snapNode({
        role: 'textbox',
        depth: 1,
        name: 'Email',
        selector: '#email',
        isInteractive: true,
        tagName: 'input'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('e1  textbox "Email" ∈ "Login"  →  #email')
  })

  it('omits ∈ context when same-depth sibling is interactive', () => {
    const nodes = [
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Cancel',
        selector: 'button*=Cancel',
        isInteractive: true,
        tagName: 'button'
      }),
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit',
        isInteractive: true,
        tagName: 'button'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    // Second button should NOT have ∈ "Cancel" context (same-depth interactive isn't context)
    expect(result.text).toContain('e2  button "Submit"  →  button*=Submit')
    expect(result.text).not.toContain('∈ "Cancel"')
  })

  it('appends .instance(N) for duplicate selectors', () => {
    const nodes = [
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Add',
        selector: 'button*=Add',
        isInteractive: true,
        tagName: 'button'
      }),
      snapNode({
        role: 'button',
        depth: 0,
        name: 'Add',
        selector: 'button*=Add',
        isInteractive: true,
        tagName: 'button'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('button*=Add.instance(0)')
    expect(result.text).toContain('button*=Add.instance(1)')
    // Elements map stores the raw selector without .instance(N)
    expect(result.elements['e1']!.selector).toBe('button*=Add')
    expect(result.elements['e2']!.selector).toBe('button*=Add')
  })

  it('handles interactive node with no name but context ancestor', () => {
    const nodes = [
      snapNode({
        role: 'form',
        depth: 0,
        name: 'Search',
        isInteractive: false,
        tagName: 'form'
      }),
      snapNode({
        role: 'textbox',
        depth: 1,
        name: '',
        selector: '#q',
        isInteractive: true,
        tagName: 'input'
      })
    ]
    const result = buildSnapshot('[Page]', nodes)
    expect(result.text).toContain('e1  textbox ∈ "Search"  →  #q')
    expect(result.elements['e1']!.text).toBe('')
  })

  it('indents according to depth', () => {
    const nodes = [
      snapNode({
        role: 'main',
        depth: 0,
        name: '',
        isInteractive: false,
        tagName: 'main'
      }),
      snapNode({
        role: 'button',
        depth: 1,
        name: 'Click',
        selector: '#btn',
        isInteractive: true,
        tagName: 'button'
      })
    ]
    const lines = buildSnapshot('[Page]', nodes).text.split('\n')
    expect(lines[1]).toMatch(/^  main/)
    expect(lines[2]).toMatch(/^    e1/)
  })
})

// ---------------------------------------------------------------------------
// accessibilityNodesToSnapshotNodes
// ---------------------------------------------------------------------------

describe('accessibilityNodesToSnapshotNodes', () => {
  it('converts interactive node and derives tagName from selector', () => {
    const input = [
      node({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit'
      })
    ]
    const result = accessibilityNodesToSnapshotNodes(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      role: 'button',
      name: 'Submit',
      selector: 'button*=Submit',
      isInteractive: true,
      tagName: 'button'
    })
  })

  it('filters out off-screen nodes when inViewportOnly is true', () => {
    const input = [
      node({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit',
        isInViewport: false
      })
    ]
    const result = accessibilityNodesToSnapshotNodes(input, {
      inViewportOnly: true
    })
    expect(result).toHaveLength(0)
  })

  it('keeps off-screen nodes when inViewportOnly is false', () => {
    const input = [
      node({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit',
        isInViewport: false
      })
    ]
    const result = accessibilityNodesToSnapshotNodes(input, {
      inViewportOnly: false
    })
    expect(result).toHaveLength(1)
  })

  it('sets isInteractive false for structural roles', () => {
    const input = [node({ role: 'navigation', depth: 0, name: 'Nav' })]
    const result = accessibilityNodesToSnapshotNodes(input)
    expect(result[0]!.isInteractive).toBe(false)
    expect(result[0]!.tagName).toBe('navigation') // fallback to role
  })

  it('suppresses statictext echoed by interactive parent', () => {
    const input = [
      node({
        role: 'button',
        depth: 0,
        name: 'Submit',
        selector: 'button*=Submit'
      }),
      node({ role: 'statictext', depth: 1, name: 'Submit' })
    ]
    const result = accessibilityNodesToSnapshotNodes(input)
    expect(result).toHaveLength(1) // statictext suppressed
    expect(result[0]!.role).toBe('button')
  })

  it('derives tagName from link selector', () => {
    const input = [
      node({ role: 'link', depth: 0, name: 'Home', selector: 'a*=Home' })
    ]
    const result = accessibilityNodesToSnapshotNodes(input)
    expect(result[0]!.tagName).toBe('a')
  })

  it('falls back to role for selectorless tag extraction', () => {
    const input = [
      node({ role: 'textbox', depth: 0, name: 'Email', selector: '#email' })
    ]
    const result = accessibilityNodesToSnapshotNodes(input)
    // #email doesn't start with a tag prefix → falls back to role
    expect(result[0]!.tagName).toBe('textbox')
  })
})

// ---------------------------------------------------------------------------
// jsonElementToSnapshotNodes
// ---------------------------------------------------------------------------

describe('jsonElementToSnapshotNodes', () => {
  it('flattens a simple tree', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl('android.widget.Button', {
        clickable: 'true',
        'content-desc': 'Submit',
        text: ''
      })
    ])
    const result = jsonElementToSnapshotNodes(root, 'android')
    // Root hierarchy element + one button = 2 nodes
    expect(result.length).toBeGreaterThanOrEqual(2)
    const button = result.find((n) => n.role === 'button')
    expect(button).toBeDefined()
    expect(button).toMatchObject({
      role: 'button',
      name: 'Submit',
      isInteractive: true,
      tagName: 'android.widget.Button'
    })
  })

  it('includes structural containers', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl(
        'android.widget.LinearLayout',
        {
          'content-desc': ''
        },
        [
          mobileEl('android.widget.Button', {
            clickable: 'true',
            'content-desc': 'OK',
            text: ''
          })
        ]
      )
    ])
    const result = jsonElementToSnapshotNodes(root, 'android')
    // LinearLayout is not in INTERACTIVE_ROLES, not clickable → structural
    expect(result.length).toBeGreaterThanOrEqual(2)
    const structNode = result.find((n) => n.role === 'LinearLayout')
    expect(structNode).toBeDefined()
    expect(structNode!.isInteractive).toBe(false)
  })

  it('suppresses tag-only-interactive children of explicit parents', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl(
        'android.widget.LinearLayout',
        {
          clickable: 'true',
          'content-desc': 'Row'
        },
        [
          // TextView is in ANDROID_INTERACTABLE_TAGS (tag-interactive),
          // but not explicitly clickable → suppressed by suppressTagOnlyChildren
          mobileEl('android.widget.TextView', {
            clickable: 'false',
            'content-desc': '',
            text: 'Label'
          })
        ]
      )
    ])
    const result = jsonElementToSnapshotNodes(root, 'android')
    const textView = result.find((n) => n.role === 'statictext')
    expect(textView).toBeDefined()
    expect(textView!.isInteractive).toBe(false) // suppressed
  })

  it('propagates tagName from the mobile element', () => {
    const root = mobileEl('hierarchy', {}, [
      mobileEl('android.widget.EditText', {
        clickable: 'true',
        'content-desc': '',
        'resource-id': 'com.example:id/email',
        text: ''
      })
    ])
    const result = jsonElementToSnapshotNodes(root, 'android')
    const editText = result.find((n) => n.role === 'textbox')
    expect(editText).toBeDefined()
    expect(editText!.tagName).toBe('android.widget.EditText')
  })
})
