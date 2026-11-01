// Pure HTTP byte-range resolution for the video endpoint. Kept separate from
// the Fastify wiring so the range math is unit-testable without a real file.

/** Matches a single-range `bytes=start-end` header (either bound optional). */
const BYTE_RANGE_RE = /^bytes=(\d*)-(\d*)$/

export type ByteRange =
  /** No (or unparsable) Range header — serve the whole file with 200. */
  | { kind: 'full' }
  /** Valid range — serve `[start, end]` inclusive with 206. */
  | { kind: 'partial'; start: number; end: number }
  /** Range outside the file — respond 416. */
  | { kind: 'unsatisfiable' }

/**
 * Resolve a `Range` request header against a file of `total` bytes. A missing
 * or malformed header yields a full response; a well-formed but out-of-bounds
 * range yields `unsatisfiable` (HTTP 416).
 */
export function resolveByteRange(
  rangeHeader: string | undefined,
  total: number
): ByteRange {
  const match = BYTE_RANGE_RE.exec(rangeHeader ?? '')
  if (!match) {
    return { kind: 'full' }
  }
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : total - 1
  if (start > end || start < 0 || end >= total) {
    return { kind: 'unsatisfiable' }
  }
  return { kind: 'partial', start, end }
}
