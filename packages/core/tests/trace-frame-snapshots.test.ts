import { describe, it, expect } from 'vitest'
import {
  buildImageFrameSnapshots,
  FrameSnapshotIndex,
  type FrameSnapshotRef
} from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'

function snap(overrides: Partial<ActionSnapshot> = {}): ActionSnapshot {
  return { timestamp: 2000, command: 'click', screenshot: 'AAAA', ...overrides }
}

describe('FrameSnapshotIndex', () => {
  it('claims a snapshot by exact command timestamp and names it after@<callId>', () => {
    const index = new FrameSnapshotIndex([snap()])
    expect(index.claimAfter(2000, 'call@2')).toBe('after@call@2')
    expect(index.refs()).toEqual([
      { callId: 'call@2', snapshotName: 'after@call@2', snapshot: snap() }
    ])
  })

  it('returns undefined for unmatched timestamps', () => {
    const index = new FrameSnapshotIndex([snap()])
    expect(index.claimAfter(1234, 'call@2')).toBeUndefined()
    expect(index.refs()).toEqual([])
  })

  it('consumes the snapshot on claim', () => {
    const index = new FrameSnapshotIndex([snap()])
    index.claimAfter(2000, 'call@2')
    expect(index.claimAfter(2000, 'call@3')).toBeUndefined()
  })

  it('ignores snapshots without a screenshot', () => {
    const index = new FrameSnapshotIndex([snap({ screenshot: undefined })])
    expect(index.claimAfter(2000, 'call@2')).toBeUndefined()
  })

  it('keeps the richest capture for duplicate timestamps', () => {
    const index = new FrameSnapshotIndex([
      snap({ screenshot: 'AA' }),
      snap({ screenshot: 'AAAAAAAA' }),
      snap({ screenshot: 'AAAA' })
    ])
    index.claimAfter(2000, 'call@2')
    expect(index.refs()[0]!.snapshot.screenshot).toBe('AAAAAAAA')
  })

  it('tracks the last claimed name as the next action before state', () => {
    const index = new FrameSnapshotIndex([
      snap(),
      snap({ timestamp: 3000, command: 'setValue' })
    ])
    expect(index.beforeName()).toBeUndefined()
    index.claimAfter(2000, 'call@2')
    expect(index.beforeName()).toBe('after@call@2')
    index.claimAfter(3000, 'call@3')
    expect(index.beforeName()).toBe('after@call@3')
  })
})

describe('buildImageFrameSnapshots', () => {
  const pageId = 'page@abc123'
  const wallTime = 1000
  const viewport = { width: 800, height: 600 }

  function ref(overrides: Partial<ActionSnapshot> = {}): FrameSnapshotRef {
    return {
      callId: 'call@2',
      snapshotName: 'after@call@2',
      snapshot: snap(overrides)
    }
  }

  it('emits events with exactly the reference field set', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    expect(Object.keys(event!)).toEqual(['type', 'snapshot'])
    expect(event!.type).toBe('frame-snapshot')
    expect(Object.keys(event!.snapshot).sort()).toEqual(
      [
        'callId',
        'collectionTime',
        'doctype',
        'frameId',
        'frameUrl',
        'html',
        'isMainFrame',
        'pageId',
        'resourceOverrides',
        'snapshotName',
        'timestamp',
        'viewport',
        'wallTime'
      ].sort()
    )
  })

  it('encodes the screenshot as an image document in node-array format', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ url: 'https://example.test/login' })],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.html).toEqual([
      'HTML',
      {},
      ['HEAD', {}, ['BASE', { href: 'https://example.test/login' }]],
      [
        'BODY',
        { style: 'margin:0' },
        [
          'IMG',
          {
            src: 'data:image/jpeg;base64,AAAA',
            style: 'display:block;width:100vw;height:100vh;object-fit:contain'
          }
        ]
      ]
    ])
  })

  it('stamps identity, timing, and frame fields from the ref', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    const s = event!.snapshot
    expect(s.callId).toBe('call@2')
    expect(s.snapshotName).toBe('after@call@2')
    expect(s.pageId).toBe(pageId)
    expect(s.frameId).toBe('frame@abc123')
    expect(s.doctype).toBe('html')
    expect(s.viewport).toEqual(viewport)
    expect(s.timestamp).toBe(1000)
    expect(s.wallTime).toBe(2000)
    expect(s.collectionTime).toBe(0)
    expect(s.resourceOverrides).toEqual([])
    expect(s.isMainFrame).toBe(true)
  })

  it('sniffs a png data uri from the base64 magic', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ screenshot: 'iVBORw0KGgo' })],
      pageId,
      wallTime,
      viewport
    )
    const html = JSON.stringify(event!.snapshot.html)
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo')
  })

  it('falls back to about:blank when the snapshot has no url', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.frameUrl).toBe('about:blank')
  })

  it('clamps timestamps captured before wallTime to zero', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ timestamp: 500 })],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.timestamp).toBe(0)
    expect(event!.snapshot.wallTime).toBe(500)
  })
})
