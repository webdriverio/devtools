import {
  waitForBody,
  parseFragment,
  parseDocument,
  getRef,
  assignRef
} from './utils.js'
import { log } from './logger.js'
import { collector } from './collector.js'

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
        mutationList.map(
          ({
            target: t,
            addedNodes: an,
            removedNodes: rn,
            type,
            attributeName,
            attributeNamespace,
            previousSibling: ps,
            nextSibling: ns,
            oldValue
          }) => {
            const addedNodes = Array.from(an).map((node) => {
              assignRef(node as Element)
              return parseFragment(node as Element)
            })

            const removedNodes = Array.from(rn).map((node) => getRef(node))
            const target = getRef(t)
            const previousSibling = ps ? getRef(ps) : null
            const nextSibling = ns ? getRef(ns) : null

            let attributeValue: string | undefined
            if (type === 'attributes') {
              attributeValue = (t as Element).getAttribute(attributeName!) || ''
            }
            let newTextContent: string | undefined
            if (type === 'characterData') {
              newTextContent = (t as Element).textContent || ''
            }

            log(`added mutation: ${type}`)
            return {
              type,
              attributeName,
              attributeNamespace,
              oldValue,
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
        )
      )
    } catch (err: any) {
      collector.captureError(err)
    }
  })
  observer.observe(document.body, config)
} catch (err: any) {
  collector.captureError(err)
}

log('Finished program')
