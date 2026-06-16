import { describe, expect, it } from 'vitest'
import type {
  CommandLog,
  NetworkRequest,
  Metadata
} from '@wdio/devtools-shared'
import {
  mergeNetworkRequests,
  replaceCommand,
  mergeSessionMetadata,
  PENDING_SESSION_KEY
} from '../src/controller/contextUpdates.js'

function cmd(
  id: number | undefined,
  timestamp: number,
  command = 'click',
  extra: Partial<CommandLog> = {}
): CommandLog & { id?: number } {
  return { command, args: [], timestamp, id, ...extra }
}

describe('replaceCommand', () => {
  it('replaces by stable `id` when both ids match', () => {
    const current = [cmd(1, 100), cmd(2, 100), cmd(3, 200)]
    const incoming = cmd(2, 100, 'click-updated')
    const next = replaceCommand(current, 100, incoming)
    expect(next).toHaveLength(3)
    expect(next[1].command).toBe('click-updated')
    expect(next[0]).toBe(current[0])
    expect(next[2]).toBe(current[2])
  })

  it('falls back to timestamp lastIndexOf when id is missing', () => {
    const current = [cmd(undefined, 100), cmd(undefined, 100)]
    const incoming = cmd(undefined, 100, 'click-final')
    const next = replaceCommand(current, 100, incoming)
    expect(next[0]).toBe(current[0])
    expect(next[1].command).toBe('click-final')
  })

  it('appends when no match found', () => {
    const current = [cmd(1, 100)]
    const incoming = cmd(99, 999, 'new')
    const next = replaceCommand(current, 999, incoming)
    expect(next).toHaveLength(2)
    expect(next[1].command).toBe('new')
  })

  it('returns a NEW array (does not mutate input)', () => {
    const current = [cmd(1, 100)]
    const incoming = cmd(1, 100, 'replaced')
    const next = replaceCommand(current, 100, incoming)
    expect(next).not.toBe(current)
    expect(current[0].command).toBe('click')
  })
})

function req(id: string | undefined, url: string): NetworkRequest {
  return {
    id: id as string,
    url,
    method: 'GET',
    timestamp: Date.now(),
    startTime: 0,
    type: 'fetch'
  }
}

describe('mergeNetworkRequests', () => {
  it('appends new entries by id', () => {
    const current = [req('1', '/a')]
    const next = mergeNetworkRequests(current, [req('2', '/b')])
    expect(next).toHaveLength(2)
    expect(next.map((r) => r.id)).toEqual(['1', '2'])
  })

  it('updates an existing entry when ids match', () => {
    const current = [req('1', '/a'), req('2', '/b')]
    const next = mergeNetworkRequests(current, [req('1', '/a-updated')])
    expect(next).toHaveLength(2)
    expect(next[0].url).toBe('/a-updated')
  })

  it('appends id-less entries (no dedup)', () => {
    const current = [req('1', '/a')]
    const noId = req(undefined, '/c')
    const next = mergeNetworkRequests(current, [noId, noId])
    expect(next).toHaveLength(3)
  })

  it('returns a new array (does not mutate input)', () => {
    const current = [req('1', '/a')]
    const next = mergeNetworkRequests(current, [req('2', '/b')])
    expect(next).not.toBe(current)
    expect(current).toHaveLength(1)
  })
})

const meta = (m: Partial<Metadata>): Metadata => m as Metadata

describe('mergeSessionMetadata', () => {
  it('creates an entry for a message carrying a sessionId', () => {
    const r = mergeSessionMetadata(
      { bySession: {} },
      meta({ sessionId: 's1', url: '/a' })
    )
    expect(r.currentSessionId).toBe('s1')
    expect(r.bySession).toEqual({ s1: { sessionId: 's1', url: '/a' } })
    expect(r.active).toEqual({ sessionId: 's1', url: '/a' })
  })

  it('merges a sessionId-less update into the current session', () => {
    const first = mergeSessionMetadata(
      { bySession: {} },
      meta({
        sessionId: 's1',
        url: '/a',
        capabilities: { browserName: 'chrome' }
      })
    )
    const next = mergeSessionMetadata(first, meta({ url: '/secure' }))
    // url updates, capabilities preserved (the overwrite regression)
    expect(next.bySession.s1).toEqual({
      sessionId: 's1',
      url: '/secure',
      capabilities: { browserName: 'chrome' }
    })
    expect(next.currentSessionId).toBe('s1')
  })

  it('keeps a second session independent of the first', () => {
    const first = mergeSessionMetadata(
      { bySession: {} },
      meta({ sessionId: 's1', url: '/a' })
    )
    const second = mergeSessionMetadata(
      first,
      meta({ sessionId: 's2', url: '/b' })
    )
    expect(second.bySession.s1).toEqual({ sessionId: 's1', url: '/a' })
    expect(second.bySession.s2).toEqual({ sessionId: 's2', url: '/b' })
    expect(second.active).toEqual({ sessionId: 's2', url: '/b' })
  })

  it('buffers under PENDING_SESSION_KEY then folds into the first session', () => {
    const pending = mergeSessionMetadata(
      { bySession: {} },
      meta({ url: '/early' })
    )
    expect(pending.bySession[PENDING_SESSION_KEY]).toEqual({ url: '/early' })
    expect(pending.currentSessionId).toBeUndefined()

    const resolved = mergeSessionMetadata(
      pending,
      meta({ sessionId: 's1', capabilities: { browserName: 'chrome' } })
    )
    expect(resolved.bySession[PENDING_SESSION_KEY]).toBeUndefined()
    expect(resolved.bySession.s1).toEqual({
      url: '/early',
      sessionId: 's1',
      capabilities: { browserName: 'chrome' }
    })
  })

  it('does not let an empty url clobber a real one (re-broadcast)', () => {
    const withUrl = mergeSessionMetadata(
      { bySession: {} },
      meta({ sessionId: 's1', url: 'https://example.com' })
    )
    // session-start re-broadcast carries url: '' — must not wipe the real url
    const after = mergeSessionMetadata(
      withUrl,
      meta({
        sessionId: 's1',
        url: '',
        capabilities: { browserName: 'chrome' }
      })
    )
    expect(after.bySession.s1.url).toBe('https://example.com')
    expect(after.bySession.s1.capabilities).toEqual({ browserName: 'chrome' })
  })

  it('treats an empty-string sessionId as absent (no ghost entry)', () => {
    const first = mergeSessionMetadata(
      { bySession: {} },
      meta({ sessionId: 's1', url: 'https://a' })
    )
    // boundary broadcast carries sessionId: '' — must attribute to current,
    // not forge a '' key
    const after = mergeSessionMetadata(first, meta({ sessionId: '' }))
    expect(Object.keys(after.bySession)).toEqual(['s1'])
    expect(after.currentSessionId).toBe('s1')
    expect(after.bySession.s1.url).toBe('https://a')
  })

  it('does not mutate the input map', () => {
    const state = { bySession: { s1: meta({ sessionId: 's1', url: '/a' }) } }
    const next = mergeSessionMetadata(
      state,
      meta({ sessionId: 's2', url: '/b' })
    )
    expect(next.bySession).not.toBe(state.bySession)
    expect(Object.keys(state.bySession)).toEqual(['s1'])
  })
})
