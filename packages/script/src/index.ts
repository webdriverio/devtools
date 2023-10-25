import { waitForBody, parseFragment, parseDocument, log, getRef, assignRef } from './utils.js'

declare global {
  interface Element {
    'wdio-ref': string
  }
  interface Window {
    changes: any[]
    logs: any[]
    errors: string[]
  }
}

window.errors = []
window.changes = []
try {
  log('waiting for body to render')
  await waitForBody()
  log('body rendered')

  assignRef(document.documentElement)
  log('applied wdio ref ids')

  window.changes.push({
    type: 'childList',
    addedNodes: [parseDocument(document.documentElement)],
    removedNodes: []
  })
  log('added initial page structure')

  const config = { attributes: true, childList: true, subtree: true }
  const observer = new MutationObserver((ml) => {
    const mutationList = ml.filter((m) => m.attributeName !== 'data-wdio-ref')

    log(`observed ${mutationList.length} mutations`)
    try {
      window.changes.push(...mutationList.map(({ target: t, addedNodes: an, removedNodes: rn, type, attributeName, attributeNamespace, previousSibling: ps, nextSibling: ns, oldValue }) => {
        const addedNodes = Array.from(an).map((node) => {
          assignRef(node as Element)
          return parseFragment(node as Element)
        })

        const removedNodes = Array.from(rn).map((node) => getRef(node))
        const target = getRef(t)
        const previousSibling = ps ? getRef(ps) : null
        const nextSibling = ns ? getRef(ns) : null

        log(`added mutation: ${type}`)
        return { type, attributeName, attributeNamespace, oldValue, addedNodes, target, removedNodes, previousSibling, nextSibling }
      }))
    } catch (err: any) {
      window.errors.push(err.stack)
    }
  })
  observer.observe(document.body, config)
} catch (err: any) {
    window.errors.push(err.stack)
}

log('Finished program')
