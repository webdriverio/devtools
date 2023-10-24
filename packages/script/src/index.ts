import { waitForBody, parseFragmentWrapper, log } from './utils.js'

declare global {
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

  const config = { attributes: true, childList: true, subtree: true }
  const observer = new MutationObserver((mutationList) => {
    log(`observed ${mutationList.length} mutations`)
    try {
      window.changes.push(...mutationList.map(({ target, addedNodes: an, removedNodes: rn, type, attributeName, attributeNamespace, oldValue }) => {
        log(`mutation: ${type}`)
        const addedNodes = Array.from(an).map((node) => parseFragmentWrapper(node))
        const removedNodes = Array.from(rn).map((node) => parseFragmentWrapper(node))
        target = parseFragmentWrapper(target)
        return { type, attributeName, attributeNamespace, oldValue, addedNodes, target, removedNodes }
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
