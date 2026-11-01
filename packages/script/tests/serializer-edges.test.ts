/**
 * @vitest-environment happy-dom
 *
 * The cases where reading the live DOM could differ from parsing serialized
 * markup. Each one is a place a difference would show up as degraded replay
 * rather than as a failure, which is what makes this path worth pinning.
 */
import { describe, it, expect } from 'vitest'

import { parseDocument, parseNode } from '../src/utils.js'

const capture = (markup: string) => {
  document.documentElement.innerHTML = markup
  return JSON.parse(JSON.stringify(parseDocument(document.documentElement)))
}

/** Every element type appearing anywhere in a captured tree. */
const types = (node: unknown, found: string[] = []): string[] => {
  if (!node || typeof node !== 'object') {
    return found
  }
  const n = node as { type?: string; props?: { children?: unknown } }
  if (n.type) {
    found.push(n.type)
  }
  const kids = n.props?.children
  for (const child of Array.isArray(kids) ? kids : kids ? [kids] : []) {
    types(child, found)
  }
  return found
}

const find = (node: unknown, type: string): any =>
  JSON.parse(JSON.stringify(node)) &&
  (function walk(n: any): any {
    if (!n || typeof n !== 'object') {
      return undefined
    }
    if (n.type === type) {
      return n
    }
    const kids = n.props?.children
    for (const c of Array.isArray(kids) ? kids : kids ? [kids] : []) {
      const hit = walk(c)
      if (hit) {
        return hit
      }
    }
    return undefined
  })(node)

describe('serializing the live DOM', () => {
  it('keeps the case foreign elements need', () => {
    // An HTML parser lowercases tag names; SVG's are case-sensitive, so
    // `linearGradient` becoming `lineargradient` renders nothing.
    const tree = capture('<body><svg><linearGradient id="g"/></svg></body>')

    expect(types(tree)).toContain('linearGradient')
  })

  it('keeps the case foreign attributes need', () => {
    const tree = capture('<body><svg viewBox="0 0 10 10"></svg></body>')

    expect(find(tree, 'svg').props).toHaveProperty('viewBox')
  })

  it('decodes entities rather than carrying their source text', () => {
    const tree = capture('<body><p title="a&amp;b">x &lt; y</p></body>')
    const p = find(tree, 'p')

    expect(p.props.title).toBe('a&b')
    expect(p.props.children).toBe('x < y')
  })

  it('reads the tree the browser built, not the markup as written', () => {
    // An unclosed <p> before a <div> is reparented by the HTML parser. The DOM
    // already reflects that; capture must not re-derive it differently.
    const tree = capture('<body><p>one<div>two</div></body>')

    expect(types(tree)).toEqual(expect.arrayContaining(['p', 'div']))
  })

  it('drops comments without leaving their text behind', () => {
    const tree = capture('<body><div><!-- build stamp -->kept</div></body>')

    expect(JSON.stringify(tree)).not.toContain('build stamp')
    expect(JSON.stringify(tree)).toContain('kept')
  })

  it('serializes a template as empty, since its content is not a child', () => {
    // `<template>` holds its content in a separate DocumentFragment. Neither
    // this nor the parser it replaced descends into it; pinned so a future
    // change to template handling is a deliberate one.
    const tree = capture('<body><template><p>hidden</p></template></body>')

    expect(JSON.stringify(tree)).not.toContain('hidden')
  })

  it('carries every attribute of an element, not a curated set', () => {
    const tree = capture(
      '<body><input id="a" class="b" data-x="c" disabled aria-label="d"></body>'
    )

    expect(find(tree, 'input').props).toMatchObject({
      id: 'a',
      class: 'b',
      'data-x': 'c',
      disabled: '',
      'aria-label': 'd'
    })
  })

  it('returns a bare string for a text node and nothing for a comment', () => {
    expect(parseNode(document.createTextNode('hello'))).toBe('hello')
    expect(parseNode(document.createComment('gone'))).toBe('')
  })

  it('survives a node with no attributes to read', () => {
    const fragment = document.createDocumentFragment()

    expect(() => parseNode(fragment)).not.toThrow()
  })
})
