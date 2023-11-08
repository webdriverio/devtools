import { waitForBody, parseFragment, parseDocument, log, getRef, assignRef, patchConsoleObject } from './utils.js'

window.wdioCaptureErrors = []
window.wdioDOMChanges = []
window.wdioConsoleLogs = []
window.wdioMetadata = {
  url: window.location.href,
  pageLoadId: Math.random().toString().slice(2),
  viewport: window.visualViewport!
}

try {
  log('waiting for body to render')
  await waitForBody()
  log('body rendered')

  patchConsoleObject()

  assignRef(document.documentElement)
  log('applied wdio ref ids')

  const timestamp = Date.now()
  window.wdioDOMChanges.push({
    type: 'childList',
    timestamp,
    addedNodes: [parseDocument(document.documentElement)],
    removedNodes: []
  })
  log('added initial page structure')

  const config = { attributes: true, childList: true, subtree: true }
  const observer = new MutationObserver((ml) => {
    const timestamp = Date.now()
    const mutationList = ml.filter((m) => m.attributeName !== 'data-wdio-ref')

    log(`observed ${mutationList.length} mutations`)
    try {
      window.wdioDOMChanges.push(...mutationList.map(({ target: t, addedNodes: an, removedNodes: rn, type, attributeName, attributeNamespace, previousSibling: ps, nextSibling: ns, oldValue }) => {
        const addedNodes = Array.from(an).map((node) => {
          assignRef(node as Element)
          return parseFragment(node as Element)
        })

        const removedNodes = Array.from(rn).map((node) => getRef(node))
        const target = getRef(t)
        const previousSibling = ps ? getRef(ps) : null
        const nextSibling = ns ? getRef(ns) : null

        log(`added mutation: ${type}`)
        return {
          type, attributeName, attributeNamespace, oldValue, addedNodes, target,
          removedNodes, previousSibling, nextSibling, timestamp
        } as TraceMutation
      }))
    } catch (err: any) {
      window.wdioCaptureErrors.push(err.stack)
    }
  })
  observer.observe(document.body, config)
} catch (err: any) {
    window.wdioCaptureErrors.push(err.stack)
}

log('Finished program')
