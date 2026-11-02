// Image-backed frame-snapshots, a shim until real DOM snapshots are captured: each action is a page
// whose <img> resolves, through `resourceOverrides`, to the screenshot already stored under `resources/`.

import { imageMime, type ActionSnapshot } from '@wdio/devtools-shared'
import { networkRequestToHar, type ResourceSnapshotEntry } from './trace-har.js'
import { screenshotResourceName } from './trace-snapshots.js'

const SNAPSHOT_DOCTYPE = 'html'
// `.invalid` never resolves (RFC 6761), so a viewer that ignores the override fetches nothing.
const SCREENSHOT_URL_ORIGIN = 'https://screenshot.wdio-devtools.invalid'
// Before every snapshot, including one clamped to 0: the viewer only serves a resource loaded before the snapshot.
const SCREENSHOT_RESOURCE_TIME = -1
const FALLBACK_FRAME_URL = 'about:blank'
const BODY_STYLE = 'margin:0'
const IMAGE_STYLE = 'display:block;width:100vw;height:100vh;object-fit:contain'

/** Serialized DOM node: text, or a [TAG, attributes, ...children] tuple. */
export type FrameSnapshotNode =
  string | [string, Record<string, string>, ...FrameSnapshotNode[]]

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

/** The response a frame-snapshot's screenshot override patches; the viewer applies an override only to a recorded resource. */
export interface ScreenshotResourceEvent extends ResourceSnapshotEntry {
  snapshot: ResourceSnapshotEntry['snapshot'] & {
    _monotonicTime: number
    pageref: string
    _frameref: string
  }
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

  /**
   * The capture describing the page when this command completed: the one at its
   * exact timestamp, else the most recent one before it.
   *
   * Non-consuming, and falls back rather than returning nothing, because several
   * actions legitimately share one page state. Nightwatch emits its native
   * assertion rows in a batch whose execution windows collapse onto the same
   * instant, so handing the capture to whichever claimed first left the rest of
   * the batch with no DOM, no a11y tree and no screenshot in the action pane.
   * And an assertion reads the page rather than changing it, so it takes no
   * capture of its own and correctly inherits the preceding action's.
   */
  claimAfter(timestamp: number, callId: string): string | undefined {
    const snap =
      this.#byTimestamp.get(timestamp) ?? this.#latestAtOrBefore(timestamp)
    if (!snap) {
      return undefined
    }
    const snapshotName = `after@${callId}`
    this.#refs.push({ callId, snapshotName, snapshot: snap })
    this.#lastName = snapshotName
    return snapshotName
  }

  #latestAtOrBefore(timestamp: number): ActionSnapshot | undefined {
    let best: ActionSnapshot | undefined
    for (const [ts, snap] of this.#byTimestamp) {
      if (ts <= timestamp && (!best || ts > best.timestamp)) {
        best = snap
      }
    }
    return best
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

/** One URL per image type, so the shared response's content type is right for every override of it. */
export function screenshotUrl(screenshot: string): string {
  const extension = imageMime(screenshot).slice('image/'.length)
  return `${SCREENSHOT_URL_ORIGIN}/action.${extension}`
}

function imageDocument(snap: ActionSnapshot): FrameSnapshotNode {
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
          src: screenshotUrl(snap.screenshot ?? ''),
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
      resourceOverrides: [
        {
          url: screenshotUrl(ref.snapshot.screenshot ?? ''),
          sha1: screenshotResourceName(pageId, ref.snapshot.timestamp)
        }
      ],
      isMainFrame: true
    }
  }))
}

/** One resource-snapshot per screenshot URL the frame-snapshots reference. */
export function buildScreenshotResourceSnapshots(
  refs: FrameSnapshotRef[],
  pageId: string
): ScreenshotResourceEvent[] {
  const byUrl = new Map<string, ScreenshotResourceEvent>()
  for (const { snapshot } of refs) {
    const screenshot = snapshot.screenshot ?? ''
    const url = screenshotUrl(screenshot)
    if (byUrl.has(url)) {
      continue
    }
    const mimeType = imageMime(screenshot)
    const har = networkRequestToHar({
      id: url,
      url,
      method: 'GET',
      status: 200,
      statusText: 'OK',
      timestamp: snapshot.timestamp,
      startTime: snapshot.timestamp,
      time: 0,
      type: 'image',
      response: { fromCache: false, headers: {}, mimeType, status: 200 }
    })
    har.snapshot.response.content._sha1 = screenshotResourceName(
      pageId,
      snapshot.timestamp
    )
    byUrl.set(url, {
      type: 'resource-snapshot',
      snapshot: {
        ...har.snapshot,
        _monotonicTime: SCREENSHOT_RESOURCE_TIME,
        pageref: pageId,
        _frameref: frameIdForPage(pageId)
      }
    })
  }
  return [...byUrl.values()]
}
