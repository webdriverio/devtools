import { describe, expect, it } from 'vitest'
import { buildSnapshotSources } from '../src/trace-reader-snapshots.js'
import type { FrameSnapshotEvent } from '../src/trace-reader-types.js'

const OWN_URL = 'https://screenshot.wdio-devtools.invalid/action.png'

function claim(
  callId: string,
  wallTime: number,
  extra: Partial<FrameSnapshotEvent['snapshot']> = {}
): FrameSnapshotEvent {
  return {
    type: 'frame-snapshot',
    snapshot: {
      callId,
      pageId: 'page@p1',
      wallTime,
      snapshotName: `after@${callId}`,
      resourceOverrides: [{ url: OWN_URL, sha1: `page@p1-${wallTime}.png` }],
      ...extra
    }
  }
}

const NAMES = new Set([
  'resources/page@p1-100.png',
  'resources/page@p1-200.png'
])

describe('buildSnapshotSources', () => {
  it('credits each capture to its first claimant and names its stored image', () => {
    expect(
      buildSnapshotSources(
        [claim('call@1', 100), claim('call@2', 100), claim('call@3', 200)],
        NAMES
      )
    ).toEqual({
      'call@1': {
        timestamp: 100,
        ownerCallId: 'call@1',
        entry: 'resources/page@p1-100.png'
      },
      'call@2': {
        timestamp: 100,
        ownerCallId: 'call@1',
        entry: 'resources/page@p1-100.png'
      },
      'call@3': {
        timestamp: 200,
        ownerCallId: 'call@3',
        entry: 'resources/page@p1-200.png'
      }
    })
  })

  it('ignores a before@ snapshot and one with no name, so neither claims a capture first', () => {
    const sources = buildSnapshotSources(
      [
        claim('call@1', 100, { snapshotName: 'before@call@1' }),
        claim('call@9', 100, { snapshotName: undefined }),
        claim('call@2', 100)
      ],
      NAMES
    )
    expect(sources).toEqual({
      'call@2': {
        timestamp: 100,
        ownerCallId: 'call@2',
        entry: 'resources/page@p1-100.png'
      }
    })
  })

  it('keeps a __proto__ callId a plain key', () => {
    const sources = buildSnapshotSources([claim('__proto__', 100)], NAMES)!
    expect(Object.getPrototypeOf(sources)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(sources, '__proto__')).toBe(
      true
    )
    expect(sources['__proto__' as keyof typeof sources]).toMatchObject({
      ownerCallId: '__proto__'
    })
  })

  it('names no image for a foreign override or one the zip does not hold', () => {
    const sources = buildSnapshotSources(
      [
        claim('call@1', 100, {
          resourceOverrides: [
            { url: 'https://site.example/a.css', sha1: 'page@p1-100.png' }
          ]
        }),
        claim('call@2', 300)
      ],
      NAMES
    )
    expect(sources?.['call@1']).toEqual({
      timestamp: 100,
      ownerCallId: 'call@1'
    })
    expect(sources?.['call@2']).toEqual({
      timestamp: 300,
      ownerCallId: 'call@2'
    })
  })

  it('finds the copy the writer that inlined screenshots stored under the stamp', () => {
    const inlined = {
      resourceOverrides: [],
      html: [
        'HTML',
        {},
        ['HEAD', {}],
        ['BODY', {}, ['IMG', { src: 'data:image/png;base64,iVBOR' }]]
      ]
    }
    const names = new Set(['resources/page@p1-100.jpeg'])
    expect(
      buildSnapshotSources([claim('call@1', 100, inlined)], names)?.['call@1']
    ).toEqual({
      timestamp: 100,
      ownerCallId: 'call@1',
      entry: 'resources/page@p1-100.jpeg'
    })
    expect(
      buildSnapshotSources(
        [claim('call@1', 100, { ...inlined, html: ['HTML', {}] })],
        names
      )?.['call@1']
    ).toEqual({ timestamp: 100, ownerCallId: 'call@1' })
  })
})
