import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { h } from 'htm/preact'

type vComment = DefaultTreeAdapterMap['commentNode']
type vElement = DefaultTreeAdapterMap['element']
type vText = DefaultTreeAdapterMap['textNode']

export function parseNode (fragment: DefaultTreeAdapterMap['childNode']): any {
  if (fragment.nodeName === '#comment') {
    return (fragment as vComment).data
  }
  if (fragment.nodeName === '#text') {
    return (fragment as vText).value
  }

  const { childNodes, attrs, tagName } = fragment as vElement
  const props: Record<string, any> = {}
  for (const p of (attrs || [])) {
      props[p.name] = p.value
  }

  try {
    return h(tagName, props, ...(childNodes || []).map(parseNode))
  } catch (err: any) {
    return h('div', {}, err.stack)
  }
}

window.logs = []
export function log (...args: any[]) {
  window.logs.push(args.map((a) => JSON.stringify(a)).join(' '))
}

export function parseFragmentWrapper (node: Node) {
  try {
    const fragment = parseFragment((node as Element).outerHTML)
    return parseNode(fragment.childNodes[0])
  } catch (err: any) {
    return h('div', {}, err.stack)
  }
}

export async function waitForBody () {
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

  function run () {
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
