import {
  waitForBody,
  parseFragment,
  parseDocument,
  getRef,
  assignRef
} from './utils.js'
import { log } from './logger.js'
import { collector } from './collector.js'

function serializeMutation(
  m: MutationRecord,
  timestamp: number
): TraceMutation {
  const addedNodes = Array.from(m.addedNodes).map((node) => {
    assignRef(node as Element)
    return parseFragment(node as Element)
  })
  const removedNodes = Array.from(m.removedNodes).map((node) => getRef(node))
  const target = getRef(m.target)
  const previousSibling = m.previousSibling ? getRef(m.previousSibling) : null
  const nextSibling = m.nextSibling ? getRef(m.nextSibling) : null
  let attributeValue: string | undefined
  if (m.type === 'attributes') {
    attributeValue = (m.target as Element).getAttribute(m.attributeName!) || ''
  }
  let newTextContent: string | undefined
  if (m.type === 'characterData') {
    newTextContent = (m.target as Element).textContent || ''
  }
  log(`added mutation: ${m.type}`)
  return {
    type: m.type,
    attributeName: m.attributeName,
    attributeNamespace: m.attributeNamespace,
    oldValue: m.oldValue,
    addedNodes,
    target,
    removedNodes,
    previousSibling,
    nextSibling,
    timestamp,
    attributeValue,
    newTextContent
  } as TraceMutation
}

try {
  log('waiting for body to render')
  await waitForBody()
  log('body rendered')

  assignRef(document.documentElement)
  log('applied wdio ref ids')

  const timestamp = Date.now()
  collector.captureMutation([
    {
      type: 'childList',
      url: document.location.href,
      timestamp,
      addedNodes: [parseDocument(document.documentElement)],
      removedNodes: []
    }
  ])
  log('added initial page structure')

  const config = { attributes: true, childList: true, subtree: true }
  const observer = new MutationObserver((ml) => {
    const timestamp = Date.now()
    const mutationList = ml.filter((m) => m.attributeName !== 'data-wdio-ref')
    log(`observed ${mutationList.length} mutations`)
    try {
      collector.captureMutation(
        mutationList.map((m) => serializeMutation(m, timestamp))
      )
    } catch (err) {
      collector.captureError(err as Error)
    }
  })
  observer.observe(document.body, config)
} catch (err) {
  collector.captureError(err as Error)
}

log('Finished program')
