// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import type { TraceArchiveClient } from '../src/controller/trace-archive.js'
import { TraceEntries } from '../src/controller/trace-entries.js'
import { FrameImages } from '../src/components/browser/frame-images.js'
import { PlayerFrames } from '../src/components/browser/player-frame.js'
import type { PlayerArchive } from '../src/controller/context.js'

/** Answers each entry with `size` bytes, holding any read for a name in `held` until released. */
function archive(size = 10) {
  const reads: string[] = []
  const held = new Map<string, () => void>()
  const state = { closed: false }
  const client: TraceArchiveClient = {
    open: () => Promise.reject(new Error('unused')),
    read: (name) => {
      reads.push(name)
      const blob = new Blob([new Uint8Array(size)])
      return name.startsWith('held')
        ? new Promise((resolve) => held.set(name, () => resolve(blob)))
        : Promise.resolve(blob)
    },
    close: () => {
      state.closed = true
    }
  }
  return { client, reads, held, state }
}

function urls() {
  let next = 0
  const revoked: string[] = []
  return {
    revoked,
    api: {
      create: () => `blob:test/${next++}`,
      revoke: (url: string) => void revoked.push(url)
    }
  }
}

describe('TraceEntries', () => {
  it('reads an entry once and serves it from the cache after', async () => {
    const { client, reads } = archive()
    const entries = new TraceEntries(100, urls().api)
    entries.attach(client)

    const [a, b] = await Promise.all([entries.url('x'), entries.url('x')])
    expect(await entries.url('x')).toBe(a)

    expect(a).toBe(b)
    expect(reads).toEqual(['x'])
    expect(entries.cachedUrl('x')).toBe(a)
    expect(entries.cachedUrl('y')).toBeUndefined()
  })

  it('drops the least recently used past its byte cap, revoking its URL', async () => {
    const { client, reads } = archive(10)
    const blobs = urls()
    const entries = new TraceEntries(25, blobs.api)
    entries.attach(client)

    const a = await entries.url('a')
    await entries.url('b')
    entries.cachedUrl('a')
    await entries.url('c')

    expect(blobs.revoked).toEqual(['blob:test/1'])
    expect(entries.cachedUrl('a')).toBe(a)
    expect(entries.cachedUrl('b')).toBeUndefined()
    await entries.url('b')
    expect(reads).toEqual(['a', 'b', 'c', 'b'])
  })

  it('releases every URL and closes the archive when the next trace attaches', async () => {
    const first = archive()
    const blobs = urls()
    const entries = new TraceEntries(100, blobs.api)
    entries.attach(first.client)
    await entries.url('a')

    entries.attach(archive().client)

    expect(first.state.closed).toBe(true)
    expect(blobs.revoked).toEqual(['blob:test/0'])
    expect(entries.cachedUrl('a')).toBeUndefined()
  })

  it('drops a read that answers after the next trace attached', async () => {
    const first = archive()
    const blobs = urls()
    const entries = new TraceEntries(100, blobs.api)
    entries.attach(first.client)
    const stale = entries.url('held-a')

    entries.attach(archive().client)
    first.held.get('held-a')!()

    expect(await stale).toBeUndefined()
    expect(entries.cachedUrl('held-a')).toBeUndefined()
  })

  it('reads text, and nothing without an archive', async () => {
    const entries = new TraceEntries(100, urls().api)
    expect(await entries.text('x')).toBeUndefined()

    entries.attach({
      open: () => Promise.reject(new Error('unused')),
      read: () => Promise.resolve(new Blob(['{"ok":true}'])),
      close: () => {}
    })
    expect(await entries.text('x')).toBe('{"ok":true}')
  })
})

describe('TraceEntries pins', () => {
  it('never drops an entry a view pinned, going past the cap instead', async () => {
    const { client } = archive(10)
    const blobs = urls()
    const entries = new TraceEntries(25, blobs.api)
    entries.attach(client)
    const view = {}
    entries.pin(view, ['a', 'b', 'c'])

    await entries.url('a')
    await entries.url('b')
    await entries.url('c')

    expect(blobs.revoked).toEqual([])
    entries.pin(view, ['c'])
    await entries.url('d')
    expect(entries.cachedUrl('c')).toBeDefined()
    expect(blobs.revoked).toEqual(['blob:test/0', 'blob:test/1'])
  })

  it('makes a URL from what it read when the entry was dropped meanwhile', async () => {
    const { client, held } = archive(10)
    const entries = new TraceEntries(15, urls().api)
    entries.attach(client)
    const pending = entries.url('held-a')
    await Promise.resolve()

    held.get('held-a')!()
    await entries.url('b')
    await entries.url('c')

    expect(await pending).toMatch(/^blob:test\//)
  })

  it('draws a strip larger than the cache with one read per frame, then settles', async () => {
    const { client, reads } = archive(1024)
    const entries = new TraceEntries(10 * 1024, urls().api)
    entries.attach(client)
    const shown: PlayerArchive = { entries, responseBodies: {} }
    const names = Array.from({ length: 20 }, (_, i) => `f${i}`)
    let renders = 0
    let srcs: (string | undefined)[] = []
    let rerender = true
    const images = new FrameImages(() => {
      rerender = true
    })
    while (rerender && renders < 1000) {
      rerender = false
      renders++
      images.pin(shown, names)
      srcs = names.map((name) => images.src(shown, name))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(renders).toBeLessThan(1000)
    expect(reads).toHaveLength(20)
    expect(srcs.every(Boolean)).toBe(true)
  })

  it('keeps the selected frame while the strip fills the cache', async () => {
    const { client } = archive(1024)
    const blobs = urls()
    const entries = new TraceEntries(4 * 1024, blobs.api)
    entries.attach(client)
    const shown: PlayerArchive = { entries, responseBodies: {} }
    const selected = new PlayerFrames(() => {})
    await selected.show([{ timestamp: 1, entry: 'chosen' }], shown, {
      command: 'click',
      args: [],
      timestamp: 1
    })
    const url = selected.current

    const strip = new FrameImages(() => {})
    const names = Array.from({ length: 8 }, (_, i) => `f${i}`)
    strip.pin(shown, names)
    await Promise.all(names.map((name) => entries.url(name)))
    strip.pin(shown, names.slice(0, 2))
    await entries.url('later')

    expect(url).toMatch(/^blob:/)
    expect(entries.cachedUrl('chosen')).toBe(url)
    expect(blobs.revoked).not.toContain(url)
  })

  it('lets a view release its pins, leaving its entries to eviction', async () => {
    const { client } = archive(10)
    const entries = new TraceEntries(15, urls().api)
    entries.attach(client)
    const view = {}
    entries.pin(view, ['a'])
    await entries.url('a')
    await entries.url('b')
    expect(entries.cachedUrl('a')).toBeDefined()

    entries.unpin(view)
    await entries.url('c')

    expect(entries.cachedUrl('a')).toBeUndefined()
  })
})
