import { createHash } from 'node:crypto'
import type { IdGenerator } from '@opentelemetry/sdk-trace'
import {
  randomSpanId,
  randomTraceId,
  SPAN_ID_BYTES
} from '@wdio/devtools-shared'

export interface PinnedSpanIds {
  traceId?: string
  spanId: string
}

/** Held until the caller clears it, since the SDK asks for a span id before it knows the parent. */
export class PinnedIdGenerator implements IdGenerator {
  #pinned: PinnedSpanIds | undefined

  pin(ids: PinnedSpanIds | undefined): void {
    this.#pinned = ids
  }

  generateTraceId(): string {
    return this.#pinned?.traceId ?? randomTraceId()
  }

  generateSpanId(): string {
    return this.#pinned?.spanId ?? randomSpanId()
  }
}

/** A child span's id is a function of its root's id, so re-pushing a manifest mints the same ids; an all-zero prefix, the one invalid id, has odds of 2^-64. */
export function derivedSpanId(rootSpanId: string, key: string): string {
  return createHash('sha256')
    .update(`${rootSpanId}:${key}`)
    .digest('hex')
    .slice(0, SPAN_ID_BYTES * 2)
}
