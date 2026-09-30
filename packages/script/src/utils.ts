import type { SimplifiedVNode } from '../types.ts'

import { log } from './logger.js'

/** Build the wire node the replay reads.
 *
 *  `children` follows the shape `h()` produced when this went through preact:
 *  absent for none, the child itself for one, an array from two. The app's
 *  `transform` and every archive already written depend on that distinction.
 *  `key` and `ref` are dropped for the same reason — preact lifted them off
 *  props, so they have never reached the wire. */
function vnode(
  type: string | undefined,
  props: Record<string, unknown>,
  children: (SimplifiedVNode | string)[]
): SimplifiedVNode {
  const normalized: Record<string, unknown> = {}
  for (const name in props) {
    if (name !== 'key' && name !== 'ref') {
      normalized[name] = props[name]
    }
  }
  if (children.length === 1) {
    normalized.children = children[0]
  } else if (children.length > 1) {
    normalized.children = children
  }
  return { type, props: normalized } as SimplifiedVNode
}

const errorNode = (className: string, err: unknown) =>
  vnode('div', { class: className }, [(err as Error)?.stack ?? String(err)])

/** Serialize a LIVE DOM node. The collector stands in the document, so the tree
 *  is read directly rather than serialized to HTML and parsed back — that round
 *  trip is what put a 148 KB HTML parser in a script injected into every
 *  document, and a preload that size stalls navigation in headed Chrome (#403).
 *
 *  Reading the DOM also describes the page the browser actually built, rather
 *  than what a second parser makes of its markup: `localName` keeps the case
 *  foreign elements need (`linearGradient`), and attribute names arrive already
 *  adjusted (`viewBox`), both of which parse5 had to special-case. */
export function parseNode(node: Node): SimplifiedVNode | string {
  if (node.nodeType === Node.COMMENT_NODE) {
    // Drop comment content — returning its data rendered the comment as visible
    // text on replay (e.g. an IE conditional comment's `<![endif]` showed as
    // text and added a line box that shifted the whole page layout down).
    return ''
  }
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue ?? ''
  }

  try {
    const element = node as Element
    const props: Record<string, unknown> = {}
    for (const attr of Array.from(element.attributes ?? [])) {
      props[attr.name] = attr.value
    }
    const children = Array.from(node.childNodes).map((child) =>
      parseNode(child)
    )
    return vnode(element.localName, props, children)
  } catch (err) {
    return errorNode('parseNode', err)
  }
}

export function parseDocument(node: HTMLElement) {
  try {
    return parseNode(node)
  } catch (err) {
    return errorNode('parseDocument', err)
  }
}

export function parseFragment(node: Element) {
  // A Text or Comment child has no attributes to read, and the replay inserts a
  // bare string as a text node; a comment is dropped, matching `parseNode`.
  if (node?.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }
  if (node?.nodeType === Node.COMMENT_NODE) {
    return ''
  }
  try {
    // The typeless wrapper is kept deliberately: it is what the fragment parser
    // produced, `transform` unwraps it, and archives already written carry it.
    return vnode(undefined, {}, [parseNode(node)])
  } catch (err) {
    return errorNode('parseFragmentWrapper', err)
  }
}

export async function waitForBody() {
  let raf = 0
  let resolve: () => void
  let reject: (err: Error) => void
  const waitForPromise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  const waitForTimeout = setTimeout(
    () => reject(new Error('Timeout waiting for body')),
    10000
  )

  function run() {
    if (!document.body) {
      return
    }

    resolve()
  }

  raf = requestAnimationFrame(run)
  await waitForPromise
  cancelAnimationFrame(raf)
  clearTimeout(waitForTimeout)
}

/** Attribute stamped on every captured element to correlate it across the
 *  mutation stream. Owned here; consumers use REF_ATTR / hasRef / getRef. */
export const REF_ATTR = 'data-wdio-ref'

let refId = 0
/**
 * assign a uid to each element so we can reference it later in the vdom
 */
export function assignRef(elem: Element) {
  if (typeof elem.querySelectorAll !== 'function') {
    log(
      'assignRef: elem has no querySelectorAll',
      elem.nodeType || elem.nodeName || elem.textContent || Object.keys(elem)
    )
    return
  }

  if (!elem.hasAttribute(REF_ATTR)) {
    elem.setAttribute(REF_ATTR, `${++refId}`)
  }

  Array.from(elem.querySelectorAll('*')).forEach((el) => {
    el.setAttribute(REF_ATTR, `${++refId}`)
  })
}

export function hasRef(elem: Element): boolean {
  return elem.hasAttribute(REF_ATTR)
}

export function getRef(elem: Node) {
  if (!elem || !(elem as Element).getAttribute) {
    return null
  }
  return (elem as Element).getAttribute(REF_ATTR)
}
