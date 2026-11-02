import { TRACE_OPEN_EVENT } from '../controller/constants.js'
import { sourcesFromFiles, type TraceSource } from './trace-sources.js'

/** Hand picked or dropped traces to the app, which opens them. */
export function announceTraceSources(
  source: EventTarget,
  sources: readonly TraceSource[]
): void {
  source.dispatchEvent(
    new CustomEvent<readonly TraceSource[]>(TRACE_OPEN_EVENT, {
      detail: sources,
      bubbles: true,
      composed: true
    })
  )
}

/** Cleared after reading, so picking the same files again still fires `change`. */
export function takePickedSources(input?: HTMLInputElement): TraceSource[] {
  const sources = sourcesFromFiles(Array.from(input?.files ?? []))
  if (input) {
    input.value = ''
  }
  return sources
}
