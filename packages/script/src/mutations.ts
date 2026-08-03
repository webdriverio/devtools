// Serialization of MutationObserver records into the `TraceMutation` wire shape
// the app's replay consumes. Split out of index.ts so the wire shape can be
// tested without running the collector's top-level bootstrap.

import { assignRef, getRef, parseFragment, REF_ATTR } from './utils.js'
import { log } from './logger.js'

declare global {
  interface TraceMutation {
    /**
     * `characterData` only: the mutated Text node's index among its parent's
     * `childNodes`. A Text node carries no ref of its own, so `target` holds its
     * PARENT element's ref and this addresses the child within it.
     */
    childIndex?: number
  }
}

/**
 * A `characterData` mutation the collector was able to address. `target` is the
 * parent ELEMENT's ref, never the mutated node's — the replay resolves the
 * element, then the child at `childIndex`, and patches that node's data alone.
 */
export interface TextMutation extends TraceMutation {
  type: 'characterData'
  target: string
  childIndex: number
}

/** Observed by the collector. `characterData` is what a framework's text patch
 *  (`textNode.data = …`) produces — without it those changes never reach the
 *  trace at all. `characterDataOldValue` is deliberately off: nothing on the
 *  replay side reads `oldValue`, and carrying it would roughly double the bytes
 *  a text-heavy page spends against the mutation-stream cap. */
export const MUTATION_OBSERVER_CONFIG: MutationObserverInit = {
  attributes: true,
  childList: true,
  characterData: true,
  subtree: true
}

/** Where a Text node lives, in terms the replay can resolve. Undefined when the
 *  parent carries no ref (or there is no parent) — the node is unaddressable. */
function textNodeAddress(
  text: Node
): { target: string; childIndex: number } | undefined {
  const parent = text.parentNode
  const target = parent && getRef(parent)
  if (!parent || !target) {
    return undefined
  }
  return {
    target,
    childIndex: Array.from(parent.childNodes).indexOf(text as ChildNode)
  }
}

/** Records worth serializing. The ref attribute `assignRef` stamps is our own
 *  bookkeeping, and an unaddressable text change would cost bytes for a record
 *  the replay could never apply. */
export function shouldCapture(m: MutationRecord): boolean {
  if (m.attributeName === REF_ATTR) {
    return false
  }
  return m.type !== 'characterData' || Boolean(textNodeAddress(m.target))
}

export function serializeMutation(
  m: MutationRecord,
  timestamp: number
): TraceMutation {
  const addedNodes = Array.from(m.addedNodes).map((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      assignRef(node as Element)
    }
    return parseFragment(node as Element)
  })
  const removedNodes = Array.from(m.removedNodes).map((node) => getRef(node))
  // A characterData record's target is the mutated Text node, which has no
  // attributes and so no ref: address it through its parent element instead.
  const address =
    m.type === 'characterData' ? textNodeAddress(m.target) : undefined
  const target = address ? address.target : getRef(m.target)
  const previousSibling = m.previousSibling ? getRef(m.previousSibling) : null
  const nextSibling = m.nextSibling ? getRef(m.nextSibling) : null
  let attributeValue: string | undefined
  if (m.type === 'attributes') {
    // A REMOVED attribute reads back as `null`, and the replay takes a record
    // carrying no value as the removal — coerced to `''` it instead says the
    // attribute is still there with an empty value, which is exactly what
    // `<input disabled>` puts on the wire, so a boolean attribute the page just
    // cleared replays as still set.
    attributeValue =
      (m.target as Element).getAttribute(m.attributeName!) ?? undefined
  }
  let newTextContent: string | undefined
  if (m.type === 'characterData') {
    // The Text node's own data — `textContent` on a Text node IS its data, so
    // this is the mutated node's new value, not the parent's whole text.
    newTextContent = m.target.textContent || ''
  }
  log(`added mutation: ${m.type}`)
  return {
    type: m.type,
    attributeName: m.attributeName,
    attributeNamespace: m.attributeNamespace,
    oldValue: m.oldValue,
    addedNodes,
    target,
    childIndex: address?.childIndex,
    removedNodes,
    previousSibling,
    nextSibling,
    timestamp,
    attributeValue,
    newTextContent
  } as TraceMutation
}
