import { describe, expect, it } from 'vitest'
import type { CommandLog, NetworkRequest } from '@wdio/devtools-shared'
import {
  mergeNetworkRequests,
  replaceCommand
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
