import { describe, expect, it } from 'vitest'

import { serializeWebSnapshot } from '../src/a11y-snapshot.js'
import type { AccessibilityNode } from '@wdio/devtools-shared'

function node(overrides: Partial<AccessibilityNode>): AccessibilityNode {
  return {
    role: 'statictext',
    name: '',
    selector: '',
    depth: 0,
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
  it('renders the page header from the context it is given', () => {
    const text = serializeWebSnapshot([], {
      url: 'https://x/login',
      title: 'The Internet'
    })

    expect(text).toBe('[Page: The Internet — https://x/login]')
  })

  it('indents by depth and appends a locator to interactive nodes only', () => {
    const text = serializeWebSnapshot([
      node({ role: 'heading', name: 'Login Page', level: 2, depth: 0 }),
      node({
        role: 'textbox',
        name: 'Username',
        selector: '#username',
        depth: 1
      })
    ])

    expect(text.split('\n')).toEqual([
      '[Page]',
      '  heading[2] "Login Page"',
      '    textbox "Username" ∈ "Login Page"  →  #username'
    ])
  })

  it('drops an interactive node with no selector — nothing can act on it', () => {
    const text = serializeWebSnapshot([node({ role: 'button', name: 'Go' })])

    expect(text).toBe('[Page]')
  })

  it('honours the viewport filter, and can be told not to', () => {
    const nodes = [
      node({ role: 'button', name: 'Go', selector: '#go', isInViewport: false })
    ]

    expect(serializeWebSnapshot(nodes)).toBe('[Page]')
    expect(
      serializeWebSnapshot(nodes, undefined, { inViewportOnly: false })
    ).toContain('#go')
  })

  it('suppresses a statictext its interactive parent already announces', () => {
    const text = serializeWebSnapshot([
      node({ role: 'button', name: 'Login', selector: '#go', depth: 0 }),
      node({ role: 'statictext', name: 'Login', depth: 1 })
    ])

    expect(text.split('\n')).toHaveLength(2)
  })
})
