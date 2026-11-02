import type { SimplifiedVNode } from '../types.ts'

import { log } from './logger.js'
import { pageMask } from './masking.js'

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

/** Field state lives on properties the attributes never see. A collector that
 *  arrives after the typing (no document-start injection: Safari, Appium) would
 *  otherwise anchor a form that replays empty. Mirrors `captureFieldState`. */
function recordFieldState(
  element: Element,
  props: Record<string, unknown>,
  masked: boolean
): void {
  const tag = element.tagName
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
    return
  }
  const field = element as HTMLInputElement
  if (
    tag === 'INPUT' &&
    (field.type === 'checkbox' || field.type === 'radio')
  ) {
    if (field.checked) {
      props.checked = ''
    } else {
      delete props.checked
    }
    return
  }
  if (masked) {
    if (field.value !== '' || 'value' in props) {
      props.value = pageMask.maskValue(field.value)
    }
    return
  }
  // Unmasked, a password's value still stays out of the archive, as element-scripts keeps it.
  if (tag === 'INPUT' && field.type === 'password') {
    return
  }
  if (field.value !== (props.value ?? '')) {
    props.value = field.value
  }
}

/** Serialize a LIVE DOM node off the DOM itself (#403); `maskText` carries a masked ancestor down so no node runs `closest`. */
export function parseNode(
  node: Node,
  maskText = false
): SimplifiedVNode | string {
  if (node.nodeType === Node.COMMENT_NODE) {
    // Drop comment content — returning its data rendered the comment as visible
    // text on replay (e.g. an IE conditional comment's `<![endif]` showed as
    // text and added a line box that shifted the whole page layout down).
    return ''
  }
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? ''
    return maskText ? pageMask.maskText(text) : text
  }

  try {
    const element = node as Element
    const inSelector = maskText || pageMask.matchesSelector(element)
    const maskedValue = inSelector || pageMask.masksFieldKind(element)
    const props: Record<string, unknown> = {}
    for (const attr of Array.from(element.attributes ?? [])) {
      props[attr.name] =
        maskedValue && attr.name === 'value'
          ? pageMask.maskValue(attr.value)
          : attr.value
    }
    recordFieldState(element, props, maskedValue)
    const childMask = inSelector || pageMask.isTypingSurface(element)
    const children = Array.from(node.childNodes).map((child) =>
      parseNode(child, childMask)
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

/** `maskText` is whether the node's new parent masks its text, which the caller reads once per record. */
export function parseFragment(node: Element, maskText = false) {
  // A Text or Comment child has no attributes to read, and the replay inserts a
  // bare string as a text node; a comment is dropped, matching `parseNode`.
  if (node?.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return maskText ? pageMask.maskText(text) : text
  }
  if (node?.nodeType === Node.COMMENT_NODE) {
    return ''
  }
  try {
    // The typeless wrapper is kept deliberately: it is what the fragment parser
    // produced, `transform` unwraps it, and archives already written carry it.
    return vnode(undefined, {}, [parseNode(node, maskText)])
  } catch (err) {
    return errorNode('parseFragmentWrapper', err)
  }
}

/** How long a missing <body> waits before the collector logs that it is late. */
export const SLOW_BODY_NOTICE_MS = 10_000

/** No timeout: a <head> blocked on a slow asset (measured: 30 s behind a 503)
 *  still reaches its body, and giving up loses that document's whole capture.
 *  A body that is late is reported instead, so a page that never gets one is
 *  visible in the collector's logs rather than silently uncaptured. */
export async function waitForBody() {
  // Injected into a loaded document, the body is already there, and a frame is
  // not: Safari's automation window paints only when something, such as a
  // screenshot, makes it, so a wait on one left the collector without its
  // listeners for the whole test. Only a document-start preload has to wait.
  if (document.body) {
    return
  }
  let raf = 0
  let resolve: () => void
  const waitForPromise = new Promise<void>((res) => {
    resolve = res
  })
  const slowNotice = setTimeout(
    () =>
      log(
        `no <body> after ${SLOW_BODY_NOTICE_MS / 1000}s; still waiting, capture starts when it arrives`
      ),
    SLOW_BODY_NOTICE_MS
  )

  // A document-start preload runs before <body> is parsed, and a slow <head>
  // paints frames before it is, so one frame's check is not enough.
  function run() {
    if (!document.body) {
      raf = requestAnimationFrame(run)
      return
    }

    resolve()
  }

  // A background tab pauses animation frames; parsing still reaches the body.
  document.addEventListener('DOMContentLoaded', run)
  raf = requestAnimationFrame(run)
  try {
    await waitForPromise
  } finally {
    cancelAnimationFrame(raf)
    clearTimeout(slowNotice)
    document.removeEventListener('DOMContentLoaded', run)
  }
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
