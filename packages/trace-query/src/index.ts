export {
  bytesZipSource,
  type ZipSource
} from '@wdio/devtools-trace/trace-reader'
export { pageOf, truncateText } from './budget.js'
export {
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_INFLATED_BYTES,
  DEFAULT_MAX_ZIP_BYTES
} from './constants.js'
export { openTrace, openTraceSource } from './open-trace.js'
export type {
  OpenedTrace,
  OpenTraceOptions,
  Page,
  PageRequest,
  TraceHandle,
  TraceSelection,
  TraceTarget,
  TruncatedText
} from './types.js'
