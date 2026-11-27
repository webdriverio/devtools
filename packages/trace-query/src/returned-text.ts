import { clipText } from './budget.js'
import type { TraceState } from './open-trace.js'
import type { HeaderField } from './types.js'

/** What a returned text is, so redaction can mask by kind or header name and page-sourced text can be marked as data. */
export type TextKind =
  | { kind: 'console' }
  | { kind: 'console-source' }
  | { kind: 'url' }
  | { kind: 'origin' }
  | { kind: 'method' }
  | { kind: 'status-text' }
  | { kind: 'mime-type' }
  | { kind: 'header-name'; field: HeaderField }
  | { kind: 'header'; field: HeaderField; name: string }
  | { kind: 'body'; mimeType?: string }
  | { kind: 'body-unavailable' }
  | { kind: 'accessibility-tree' }
  | { kind: 'screenshot-unavailable' }

export type TextContext = TextKind & {
  state: TraceState
  /** Characters the text may take, the note of a cut included. */
  maxChars: number
}

// The one exit for text taken from the run or the page, so redaction and untrusted-data marking apply in one place.
export function returnedText(text: string, context: TextContext): string {
  return clipText(text, context.maxChars)
}
