import { waitForBody, getRef } from './utils.js'
import {
  MUTATION_OBSERVER_CONFIG,
  serializeMutation,
  shouldCapture
} from './mutations.js'
import { log } from './logger.js'
import { collector } from './collector.js'

try {
  log('waiting for body to render')
  await waitForBody()
  log('body rendered')

  collector.captureCurrentDom()
  log('added initial page structure')

  const observer = new MutationObserver((ml) => {
    const timestamp = Date.now()
    const mutationList = ml.filter(shouldCapture)
    log(`observed ${mutationList.length} mutations`)
    try {
      collector.captureMutation(
        mutationList.map((m) => serializeMutation(m, timestamp))
      )
    } catch (err) {
      collector.captureError(err as Error)
    }
  })
  observer.observe(document.body, MUTATION_OBSERVER_CONFIG)

  // Form-field state (value / checked) lives on element PROPERTIES, which the
  // MutationObserver never reports — so a replayed page shows empty inputs even
  // after a fill. Capture input/change and emit a synthetic attribute mutation
  // carrying the live value so the replay shows what was typed or selected.
  const captureFieldState = (target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return
    }
    const tag = target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      return
    }
    const ref = getRef(target)
    if (!ref) {
      return
    }
    const el = target as HTMLInputElement
    const checkable =
      tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
    collector.captureMutation([
      {
        type: 'attributes',
        target: ref,
        attributeName: checkable ? 'checked' : 'value',
        attributeValue: checkable ? String(el.checked) : String(el.value),
        addedNodes: [],
        removedNodes: [],
        timestamp: Date.now()
      } as TraceMutation
    ])
  }
  document.addEventListener('input', (e) => captureFieldState(e.target), true)
  document.addEventListener('change', (e) => captureFieldState(e.target), true)
} catch (err) {
  collector.captureError(err as Error)
}

log('Finished program')
