// Image-backed frame-snapshot synthesis: each action screenshot becomes a
// minimal DOM document so standard trace viewers render the action pane.
// Compatibility shim until real DOM snapshots are captured.

import type { ActionSnapshot } from '@wdio/devtools-shared'

const SNAPSHOT_DOCTYPE = 'html'
const FALLBACK_FRAME_URL = 'about:blank'
const BODY_STYLE = 'margin:0'
const IMAGE_STYLE = 'display:block;width:100vw;height:100vh;object-fit:contain'

/** Serialized DOM node: text, or a [TAG, attributes, ...children] tuple. */
export type FrameSnapshotNode =
  | string
  | [string, Record<string, string>, ...FrameSnapshotNode[]]

export interface FrameSnapshotResourceOverride {
  url: string
  sha1?: string
  ref?: number
}

export interface FrameSnapshot {
  callId: string
  snapshotName: string
  pageId: string
  frameId: string
  frameUrl: string
  doctype?: string
  html: FrameSnapshotNode
  viewport: { width: number; height: number }
  timestamp: number
  wallTime: number
  collectionTime: number
  resourceOverrides: FrameSnapshotResourceOverride[]
  isMainFrame: boolean
}

export interface FrameSnapshotEvent {
  type: 'frame-snapshot'
  snapshot: FrameSnapshot
}

export interface FrameSnapshotRef {
  callId: string
  snapshotName: string
  snapshot: ActionSnapshot
}

/** Correlates captured screenshots to callIds as the exporter assigns them. */
export class FrameSnapshotIndex {
  #byTimestamp = new Map<number, ActionSnapshot>()
  // Element rects by timestamp, indexed independently of the screenshot gate so
  // A8 input points resolve even when the frame carries no screenshot.
  #elementsByTimestamp = new Map<number, unknown[]>()
  #refs: FrameSnapshotRef[] = []
  #lastName?: string

  constructor(snapshots: ActionSnapshot[]) {
    for (const snap of snapshots) {
      if (snap.elements) {
        const currentEls = this.#elementsByTimestamp.get(snap.timestamp)
        if (!currentEls || snap.elements.length > currentEls.length) {
          this.#elementsByTimestamp.set(snap.timestamp, snap.elements)
        }
      }
      if (!snap.screenshot) {
        continue
      }
      const current = this.#byTimestamp.get(snap.timestamp)
      // Same-timestamp duplicates keep the richest capture (dedupe parity).
      if (
        !current ||
        snap.screenshot.length > (current.screenshot?.length ?? 0)
      ) {
        this.#byTimestamp.set(snap.timestamp, snap)
      }
    }
  }

  /** Captured element rects at a command's completion timestamp, if any. */
  elementsAt(timestamp: number): unknown[] | undefined {
    return this.#elementsByTimestamp.get(timestamp)
  }

  /** Snapshot name representing the page state before the next action. */
  beforeName(): string | undefined {
    return this.#lastName
  }

  /** Claims the screenshot captured at the command's completion, if any. */
  claimAfter(timestamp: number, callId: string): string | undefined {
    const snap = this.#byTimestamp.get(timestamp)
    if (!snap) {
      return undefined
    }
    this.#byTimestamp.delete(timestamp)
    const snapshotName = `after@${callId}`
    this.#refs.push({ callId, snapshotName, snapshot: snap })
    this.#lastName = snapshotName
    return snapshotName
  }

  refs(): FrameSnapshotRef[] {
    return this.#refs
  }
}

function frameIdForPage(pageId: string): string {
  const suffix = pageId.startsWith('page@')
    ? pageId.slice('page@'.length)
    : pageId
  return `frame@${suffix}`
}

// Captures come from WebDriver screenshots (PNG) or CDP screencasts (JPEG),
// so the mime is sniffed from the base64 magic rather than assumed.
function imageMimeType(base64: string): string {
  return base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg'
}

function imageDocument(snap: ActionSnapshot): FrameSnapshotNode {
  const screenshot = snap.screenshot ?? ''
  return [
    'HTML',
    {},
    ['HEAD', {}, ['BASE', { href: snap.url ?? FALLBACK_FRAME_URL }]],
    [
      'BODY',
      { style: BODY_STYLE },
      [
        'IMG',
        {
          src: `data:${imageMimeType(screenshot)};base64,${screenshot}`,
          style: IMAGE_STYLE
        }
      ]
    ]
  ]
}

/** One frame-snapshot event per claimed screenshot, viewer-shape exact. */
export function buildImageFrameSnapshots(
  refs: FrameSnapshotRef[],
  pageId: string,
  wallTime: number,
  viewport: { width: number; height: number }
): FrameSnapshotEvent[] {
  const frameId = frameIdForPage(pageId)
  return refs.map((ref) => ({
    type: 'frame-snapshot' as const,
    snapshot: {
      callId: ref.callId,
      snapshotName: ref.snapshotName,
      pageId,
      frameId,
      frameUrl: ref.snapshot.url ?? FALLBACK_FRAME_URL,
      doctype: SNAPSHOT_DOCTYPE,
      html: imageDocument(ref.snapshot),
      viewport: { width: viewport.width, height: viewport.height },
      timestamp: Math.max(0, ref.snapshot.timestamp - wallTime),
      wallTime: ref.snapshot.timestamp,
      collectionTime: 0,
      resourceOverrides: [],
      isMainFrame: true
    }
  }))
}
