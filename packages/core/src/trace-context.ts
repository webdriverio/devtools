import { createHash } from 'node:crypto'
import {
  randomSpanId,
  parseTraceparent,
  TRACE_CONTEXT_ENV,
  type ParentTraceContext,
  type TestTraceContext
} from '@wdio/devtools-shared'
import { resolveRunId } from './run-id.js'

// Sampling is the parent's to decide, and the manifest records it once on `parent`, so an attempt carries ids alone.
export type AttemptIds = Pick<TestTraceContext, 'traceId' | 'spanId'>

let parentCache: { value: ParentTraceContext | undefined } | undefined

/** The trace one test's attempts share, derived from the run id and the test's uid. */
export function testTraceId(runId: string, uid: string): string {
  return createHash('sha256')
    .update(`${runId}\n${uid}`)
    .digest('hex')
    .slice(0, 32)
}

/** An attempt joins the parent's trace, else its test's, so a test's retries share a trace. */
export function mintTraceContext(
  uid: string,
  parent?: TestTraceContext
): AttemptIds {
  return {
    traceId: parent?.traceId ?? testTraceId(resolveRunId(), uid),
    spanId: randomSpanId()
  }
}

/** The `TRACEPARENT` this process was launched under, read once per process. */
export function resolveParentTraceContext(): ParentTraceContext | undefined {
  parentCache ??= { value: readParentFromEnv() }
  return parentCache.value
}

function readParentFromEnv(): ParentTraceContext | undefined {
  const header = process.env[TRACE_CONTEXT_ENV.TRACEPARENT]
  if (!header) {
    return undefined
  }
  const parent = parseTraceparent(header)
  if (parent === undefined) {
    process.emitWarning(
      `Ignoring invalid ${TRACE_CONTEXT_ENV.TRACEPARENT}; expected a W3C traceparent.`,
      'DevToolsTraceContext'
    )
    return undefined
  }
  const traceState = process.env[TRACE_CONTEXT_ENV.TRACESTATE]
  return traceState ? { ...parent, traceState } : parent
}
