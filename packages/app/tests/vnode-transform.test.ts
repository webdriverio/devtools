/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import type { VNode } from 'preact'

import { transform } from '../src/components/browser/vnode-transform.js'
// The producers on the other side of the wire. `transform` only ever sees what
// these two emit, so the shapes below are taken from them rather than guessed:
// `parseDocument` serializes the full-DOM anchor (collector.captureCurrentDom),
// `parseFragment` every added node of a childList mutation (serializeMutation).
import {
  assignRef,
  parseDocument,
  parseFragment
} from '../../script/src/utils.js'

/** `transform`'s input type is module-private; this is the same shape. */
interface Serialized {
  type?: string
  props?: {
    children?: Serialized | Serialized[] | string | number
  } & Record<string, unknown>
}

/** Preact types a VNode's props by its component, so an anonymous element's
 *  captured attributes are only reachable as an index signature. */
const propsOf = (node: VNode<{}>): Record<string, unknown> =>
  node.props as Record<string, unknown>

const childrenOf = (node: VNode<{}>): unknown => propsOf(node).children

/** One transformed child, as `h()` leaves it for a single-child node. */
const onlyChild = (node: VNode<{}>): VNode<{}> => childrenOf(node) as VNode<{}>

const childList = (node: VNode<{}>): VNode<{}>[] =>
  childrenOf(node) as VNode<{}>[]

/** Captures `markup` the way the injected script does: stamp refs on every
 *  element, then serialize. Returns the payload that reaches `transform`. */
function captureFragment(markup: string): Serialized {
  const holder = document.createElement('div')
  holder.innerHTML = markup
  const element = holder.firstElementChild as Element
  assignRef(element)
  return parseFragment(element) as Serialized
}

/** Captures a whole page the way `collector.captureCurrentDom` does. */
function captureDocument(markup: string): Serialized {
  document.documentElement.innerHTML = markup
  assignRef(document.documentElement)
  return parseDocument(document.documentElement) as Serialized
}

describe('transform', () => {
  describe('text passthrough', () => {
    it('returns a text child unchanged', () => {
      // parseNode() returns a bare string for a #text node, and Preact renders
      // a string child as text — so there is nothing to convert.
      expect(transform('You logged into a secure area!')).toBe(
        'You logged into a secure area!'
      )
    })

    it('returns a numeric child unchanged', () => {
      expect(transform(42)).toBe(42)
    })

    it('returns null unchanged', () => {
      expect(transform(null)).toBeNull()
    })
  })

  describe('the fragment wrapper an added node arrives in', () => {
    // parseFragment() serializes a documentFragment, whose nodeName has no
    // tagName — so `h(undefined, {}, root)` wraps every added node in a typeless
    // node. That wrapper is what the ToDo in vnode-transform.ts is about.
    it('is the shape packages/script actually produces for an added node', () => {
      const captured = captureFragment('<p id="error">Invalid credentials</p>')

      expect(captured.type).toBeUndefined()
      expect(Array.isArray(captured.props?.children)).toBe(false)
      expect((captured.props?.children as Serialized).type).toBe('p')
    })

    it('is unwrapped to the element it wraps', () => {
      const captured = captureFragment('<p id="error">Invalid credentials</p>')

      const node = transform(captured)

      expect(node.type).toBe('p')
      expect(propsOf(node).id).toBe('error')
      expect(childrenOf(node)).toBe('Invalid credentials')
    })

    it('carries the captured ref through the unwrap', () => {
      // The ref is what the replay matches later mutations against, so losing it
      // in the unwrap would strand every mutation targeting the inserted node.
      const captured = captureFragment('<p id="error"></p>')
      const ref = (captured.props?.children as Serialized).props?.[
        'data-wdio-ref'
      ]

      expect(typeof ref).toBe('string')
      expect(propsOf(transform(captured))['data-wdio-ref']).toBe(ref)
    })

    it('discards the wrapper and keeps only the wrapped element', () => {
      const node = transform({
        props: { class: 'wrapper', children: { type: 'span', props: {} } }
      })

      expect(node.type).toBe('span')
      expect(propsOf(node).class).toBeUndefined()
    })

    it('is not unwrapped when the node has a type of its own', () => {
      const node = transform({
        type: 'div',
        props: { children: { type: 'span', props: {} } }
      })

      expect(node.type).toBe('div')
      expect(onlyChild(node).type).toBe('span')
    })

    it('is not unwrapped when the wrapper holds several children', () => {
      // A multi-root fragment stays typeless. serializeMutation() serializes
      // each added node on its own, so this never reaches the replay — but the
      // branch is what keeps it from silently dropping the second root.
      const node = transform({
        props: {
          children: [
            { type: 'span', props: {} },
            { type: 'em', props: {} }
          ]
        }
      })

      expect(node.type).toBeUndefined()
      expect(childList(node).map((child) => child.type)).toEqual(['span', 'em'])
    })

    it('is not unwrapped when its only child is text', () => {
      const node = transform({ props: { children: 'Saved' } })

      expect(node.type).toBeUndefined()
      expect(childrenOf(node)).toBe('Saved')
    })
  })

  describe('children normalisation', () => {
    it('leaves a single child as the one child, not a list', () => {
      // `h(type, props, child)` stores the child itself; a list only appears
      // from two children up. Both shapes come off the wire, so both are
      // normalised here rather than downstream.
      const node = transform({
        type: 'form',
        props: { children: { type: 'input', props: { id: 'username' } } }
      })

      expect(Array.isArray(childrenOf(node))).toBe(false)
      expect(onlyChild(node).type).toBe('input')
    })

    it('keeps several children as a list, in order', () => {
      const node = transform({
        type: 'ul',
        props: {
          children: [
            { type: 'li', props: { id: 'first' } },
            { type: 'li', props: { id: 'second' } }
          ]
        }
      })

      expect(childList(node).map((child) => propsOf(child).id)).toEqual([
        'first',
        'second'
      ])
    })

    it('transforms each child of a list rather than passing it through raw', () => {
      const first: Serialized = { type: 'li', props: {} }
      const second: Serialized = { type: 'li', props: {} }

      const node = transform({
        type: 'ul',
        props: { children: [first, second] }
      })

      expect(childList(node)).not.toContain(first)
      expect(childList(node)).not.toContain(second)
      expect(childList(node).map((child) => child.type)).toEqual(['li', 'li'])
    })

    it('flattens a one-item child list to a bare child', () => {
      // `h(type, props, ...[one])` is a three-argument call, so the two wire
      // shapes converge — a consumer can never tell an array of one from a
      // single child, which is why nothing downstream branches on it.
      const node = transform({
        type: 'form',
        props: { children: [{ type: 'input', props: {} }] }
      })

      expect(Array.isArray(childrenOf(node))).toBe(false)
      expect(onlyChild(node).type).toBe('input')
    })

    it('mixes text and element children in capture order', () => {
      const node = transform({
        type: 'p',
        props: {
          // Real captures interleave text nodes with elements; SerializedVNode's
          // children type doesn't model strings, so this mirrors runtime shape.
          children: ['Signed in as ', { type: 'b', props: {} }, '.'] as never
        }
      })

      expect(
        childList(node).map((child) =>
          typeof child === 'string' ? child : child.type
        )
      ).toEqual(['Signed in as ', 'b', '.'])
    })

    it('leaves a childless node with no children at all', () => {
      const node = transform({ type: 'input', props: { id: 'username' } })

      expect('children' in propsOf(node)).toBe(false)
    })

    it('leaves a node whose only child is an empty string childless', () => {
      // parseNode() returns '' for a comment, which is how a comment is dropped
      // from the replay instead of rendering as visible text.
      const node = transform({ type: 'div', props: { children: '' } })

      expect('children' in propsOf(node)).toBe(false)
    })
  })

  describe('props', () => {
    it('spreads the captured attributes onto the rendered node', () => {
      const node = transform({
        type: 'input',
        props: {
          id: 'username',
          type: 'text',
          value: 'tomsmith',
          'data-wdio-ref': '7'
        }
      })

      expect(propsOf(node)).toMatchObject({
        id: 'username',
        type: 'text',
        value: 'tomsmith',
        'data-wdio-ref': '7'
      })
    })

    it('never renders the serialized child list as a prop', () => {
      const serializedChild: Serialized = { type: 'span', props: {} }

      const node = transform({
        type: 'div',
        props: { id: 'flash', children: serializedChild }
      })

      expect(propsOf(node).id).toBe('flash')
      expect(childrenOf(node)).not.toBe(serializedChild)
    })

    it('tolerates a node captured without props', () => {
      const node = transform({ type: 'br' })

      expect(node.type).toBe('br')
      expect(propsOf(node)).toEqual({})
    })
  })

  describe('a captured page', () => {
    const PAGE =
      '<head><meta charset="utf-8"><title>Login</title></head>' +
      '<body><form id="login"><input id="username" value="tomsmith"></form></body>'

    it('rebuilds html > [head, body] as the document anchor carries it', () => {
      const captured = captureDocument(PAGE)

      const root = transform(captured)

      expect(root.type).toBe('html')
      expect(childList(root).map((child) => child.type)).toEqual([
        'head',
        'body'
      ])
    })

    it('transforms nested children all the way down', () => {
      const root = transform(captureDocument(PAGE))
      const body = childList(root)[1]
      const form = onlyChild(body)
      const username = onlyChild(form)

      expect(propsOf(form).id).toBe('login')
      expect(username.type).toBe('input')
      expect(propsOf(username).value).toBe('tomsmith')
    })

    it('keeps the ref of an element nested inside the page', () => {
      const captured = captureDocument(PAGE)
      const ref = document
        .querySelector('#username')
        ?.getAttribute('data-wdio-ref')

      const username = onlyChild(onlyChild(childList(transform(captured))[1]))

      expect(ref).toBeTruthy()
      expect(propsOf(username)['data-wdio-ref']).toBe(ref)
    })

    it('gives a one-child head a bare child rather than a list', () => {
      // snapshot.ts's #renderNewDocument prepends its <base> by spreading
      // head.props.children, so this shape — a real page with a single <title>
      // — is the one that makes the rebuild throw and the iframe stay blank.
      const root = transform(
        captureDocument('<head><title>Login</title></head><body></body>')
      )
      const head = childList(root)[0]

      expect(head.type).toBe('head')
      expect(Array.isArray(childrenOf(head))).toBe(false)
      expect(onlyChild(head).type).toBe('title')
    })
  })
})
