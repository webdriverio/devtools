import { TRACE_OPEN_EVENT } from '../controller/constants.js'

/** Hand a picked or dropped trace.zip to the app, which opens it. */
export function announceTraceFile(source: EventTarget, file: File): void {
  source.dispatchEvent(
    new CustomEvent(TRACE_OPEN_EVENT, {
      detail: file,
      bubbles: true,
      composed: true
    })
  )
}

/** Cleared after reading, so picking the same file again still fires `change`. */
export function takePickedFile(input?: HTMLInputElement): File | undefined {
  const file = input?.files?.[0]
  if (input) {
    input.value = ''
  }
  return file
}
