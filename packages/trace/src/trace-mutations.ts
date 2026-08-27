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

/** A full-document anchor rather than an observed diff. `url` is the reliable
 *  discriminator: only the collector's `captureCurrentDom` sets it, and neither
 *  the MutationObserver serializer nor the synthetic field-state records do. */
function isDomAnchor(mutation: TraceMutation): boolean {
  return mutation.type === 'childList' && mutation.url !== undefined
}

/**
 * Re-stamp the full-document anchors in a freshly drained batch onto the action
 * that produced the document.
 *
 * An anchor carries the document's own birth time, which lands a few ms *after*
 * the command that navigated there — so the navigating action's row, which ends
 * the moment the command was logged, still resolves to the PREVIOUS page's DOM.
 *
 * `resolve` maps an anchor's own timestamp to the action it belongs to. Deriving
 * it from the anchor rather than from whichever drain collected it is what makes
 * this race-free: several drains compete for a fresh collector's buffer (the
 * first `getTraceData` empties it) and the winner is routinely a later command's
 * post-DOM drain, so trusting the collecting drain mis-credited the anchor.
 *
 * `floor` is the newest timestamp already in the accumulated stream. An anchor is
 * never pulled ahead of mutations belonging to the document it replaces — replay
 * would then apply those stale refs to the new tree — and never pushed later than
 * the page stamped it, so an overshooting attribution is simply ignored.
 */
export function reattributeDomAnchors(
  batch: TraceMutation[],
  resolve: (anchorOwnTime: number) => number | undefined,
  floor = 0
): void {
  let lowerBound = floor
  for (const mutation of batch) {
    if (isDomAnchor(mutation)) {
      const attributed = resolve(mutation.timestamp)
      if (attributed !== undefined) {
        const target = Math.max(attributed, lowerBound)
        if (target < mutation.timestamp) {
          mutation.timestamp = target
        }
      }
    }
    lowerBound = Math.max(lowerBound, mutation.timestamp)
  }
}

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
