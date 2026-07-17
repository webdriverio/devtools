// Serialize the captured DOM mutation stream into the trace zip's
// `trace.mutations` NDJSON entry so the offline player can replay DOM
// time-travel. Standard trace viewers ignore the unknown entry, so it's
// compat-safe. Keep-earliest under the byte cap — the initial full-DOM
// childList and early diffs survive so replay-from-start stays intact; only
// late mutations drop, and a trailing sentinel records how many.

import type {
  MutationsTruncationMarker,
  TraceMutation
} from '@wdio/devtools-shared'

/** Ceiling on the serialized `trace.mutations` payload — keeps archives bounded
 *  on mutation-heavy SPAs. Late mutations drop first (replay-from-start holds). */
export const MAX_MUTATIONS_NDJSON_BYTES = 50 * 1024 * 1024

export interface MutationsNdjsonResult {
  /** NDJSON payload (one mutation per line, optional trailing marker). Empty
   *  buffer when there are no mutations. */
  ndjson: Buffer
  truncated: boolean
  /** Count actually written (excludes the dropped tail and the marker line). */
  written: number
}

/**
 * Serialize mutations to NDJSON under `cap` bytes, keeping the earliest. The
 * first mutation is always emitted (even if it alone exceeds the cap) so the
 * initial full-DOM snapshot is never lost; when any are dropped a
 * `MutationsTruncationMarker` line is appended.
 */
export function buildMutationsNdjson(
  mutations: readonly TraceMutation[],
  cap: number = MAX_MUTATIONS_NDJSON_BYTES
): MutationsNdjsonResult {
  if (!mutations.length) {
    return { ndjson: Buffer.alloc(0), truncated: false, written: 0 }
  }
  const lines: string[] = []
  let bytes = 0
  for (const mutation of mutations) {
    const line = JSON.stringify(mutation)
    // +1 for the '\n' that will join this line to the previous one.
    const add = Buffer.byteLength(line, 'utf8') + (lines.length ? 1 : 0)
    if (lines.length > 0 && bytes + add > cap) {
      break
    }
    lines.push(line)
    bytes += add
  }
  const written = lines.length
  const dropped = mutations.length - written
  if (dropped > 0) {
    const marker: MutationsTruncationMarker = { __truncated__: true, dropped }
    lines.push(JSON.stringify(marker))
  }
  return {
    ndjson: Buffer.from(lines.join('\n'), 'utf8'),
    truncated: dropped > 0,
    written
  }
}
