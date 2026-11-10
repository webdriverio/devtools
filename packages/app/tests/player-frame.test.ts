// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { PlayerFrames } from '../src/components/browser/player-frame.js'
import type { PlayerArchive } from '../src/controller/context.js'
import { TraceEntries } from '../src/controller/trace-entries.js'

/** The first 24 bytes of a PNG, which name its size. */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function shownArchive(
  images: Record<string, Uint8Array<ArrayBuffer>>,
  maxBytes = 1024 * 1024
) {
  let next = 0
  const entries = new TraceEntries(maxBytes, {
    create: () => `blob:test/${next++}`,
    revoke: () => {}
  })
  entries.attach({
    open: () => Promise.reject(new Error('unused')),
    read: (name) => Promise.resolve(new Blob([images[name]!])),
    close: () => {}
  })
  const archive: PlayerArchive = {
    entries,
    frameSize: { width: 1280, height: 720 },
    responseBodies: {}
  }
  return archive
}

const row = (timestamp: number) => ({ command: 'click', args: [], timestamp })

describe('PlayerFrames', () => {
  it("shapes the shown frame by its own size, which a rotation changes from the first frame's", async () => {
    const archive = shownArchive({
      landscape: pngHeader(1280, 720),
      portrait: pngHeader(720, 1280)
    })
    const frames = [
      { timestamp: 1, entry: 'landscape' },
      { timestamp: 5, entry: 'portrait' }
    ]
    const shown = new PlayerFrames(() => {})

    await shown.show(frames, archive, row(6))

    expect(shown.current).toMatch(/^blob:test\//)
    expect(shown.size).toEqual({ width: 720, height: 1280 })
  })

  it('drops a read a later pick overtook', async () => {
    const archive = shownArchive({
      a: pngHeader(1, 1),
      b: pngHeader(2, 2)
    })
    const frames = [
      { timestamp: 1, entry: 'a' },
      { timestamp: 5, entry: 'b' }
    ]
    const shown = new PlayerFrames(() => {})

    await Promise.all([
      shown.show(frames, archive, row(1)),
      shown.show(frames, archive, row(6))
    ])

    expect(shown.size).toEqual({ width: 2, height: 2 })
  })

  it('releases the shown frame to the cache when the view leaves', async () => {
    const archive = shownArchive(
      { a: pngHeader(1, 1), b: pngHeader(2, 2), c: pngHeader(3, 3) },
      1
    )
    const shown = new PlayerFrames(() => {})
    await shown.show([{ timestamp: 1, entry: 'a' }], archive, row(1))
    await archive.entries.url('b')
    expect(archive.entries.cachedUrl('a')).toBeDefined()

    shown.release(archive)
    await archive.entries.url('c')

    expect(archive.entries.cachedUrl('a')).toBeUndefined()
  })
})
