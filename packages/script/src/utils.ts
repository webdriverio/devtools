import {
  parse,
  parseFragment as parseFragmentImport,
  type DefaultTreeAdapterMap
} from 'parse5'
import { h } from 'htm/preact'
import type { SimplifiedVNode } from '../types.ts'

import { log } from './logger.js'

export type vFragment = DefaultTreeAdapterMap['documentFragment']
export type vComment = DefaultTreeAdapterMap['commentNode']
export type vElement = DefaultTreeAdapterMap['element']
export type vText = DefaultTreeAdapterMap['textNode']
export type vChildNode = DefaultTreeAdapterMap['childNode']

function createVNode(elem: any) {
  const { type, props } = elem
  return { type, props } as SimplifiedVNode
}

export function parseNode(
  fragment: vFragment | vComment | vText | vChildNode
): SimplifiedVNode | string {
  const props: Record<string, any> = {}

  if (fragment.nodeName === '#comment') {
    return (fragment as vComment).data
  }
  if (fragment.nodeName === '#text') {
    return (fragment as vText).value
  }

  const { childNodes, attrs, tagName } = fragment as vElement
  for (const p of attrs || []) {
    props[p.name] = p.value
  }

  try {
    return createVNode(
      h(tagName, props, ...(childNodes || []).map((cn) => parseNode(cn))) as any
    )
  } catch (err: any) {
    return createVNode(h('div', { class: 'parseNode' }, err.stack))
  }
}

export function parseDocument(node: HTMLElement) {
  try {
    const fragment = parse(node.outerHTML)
    return parseNode(fragment.childNodes[0])
  } catch (err: any) {
    return createVNode(h('div', { class: 'parseDocument' }, err.stack))
  }
}

export function parseFragment(node: Element) {
  try {
    const fragment = parseFragmentImport(node.outerHTML)
    return parseNode(fragment)
  } catch (err: any) {
    return createVNode(h('div', { class: 'parseFragmentWrapper' }, err.stack))
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

  if (!elem.hasAttribute('data-wdio-ref')) {
    elem.setAttribute('data-wdio-ref', `${++refId}`)
  }

  Array.from(elem.querySelectorAll('*')).forEach((el) => {
    el.setAttribute('data-wdio-ref', `${++refId}`)
  })
}

export function getRef(elem: Node) {
  if (!elem || !(elem as Element).getAttribute) {
    return null
  }
  return (elem as Element).getAttribute('data-wdio-ref')
}
