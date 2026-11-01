import { describe, it, expect } from 'vitest'
import type { CommandLog, TraceMutation } from '@wdio/devtools-shared'

import { elapsedSince, timelineStart } from '../src/utils/elapsed.js'

/** Wall-clock origin of the run below — every offset reads as ms into it. */
const RUN_START = 1_700_000_000_000

const command = (offset: number): CommandLog => ({
  command: 'click',
  args: [],
  timestamp: RUN_START + offset
})

const documentLoad = (offset: number): TraceMutation =>
  ({
    type: 'childList',
    url: 'https://example.com/login',
    addedNodes: [],
    removedNodes: [],
    timestamp: RUN_START + offset
  }) as TraceMutation

describe('timelineStart', () => {
  it('is the earliest timestamp in the series', () => {
    expect(timelineStart([command(400), command(780), command(1260)])).toBe(
      RUN_START + 400
    )
  })

  it('ignores the order the entries arrived in', () => {
    // Capture order is not timeline order: a replayed slice, a rerun or a
    // reversed reader hands the views either. Taking `entries[0]` would make the
    // baseline depend on delivery order.
    expect(timelineStart([command(1260), command(400), command(780)])).toBe(
      RUN_START + 400
    )
  })

  it('is the entry itself for a lone entry', () => {
    expect(timelineStart([command(400)])).toBe(RUN_START + 400)
  })

  it('is undefined for an empty series, not the epoch', () => {
    expect(timelineStart([])).toBeUndefined()
  })

  it('measures a mixed command and mutation series alike', () => {
    expect(timelineStart([command(400), documentLoad(120)])).toBe(
      RUN_START + 120
    )
  })
})

describe('elapsedSince', () => {
  const commands = [command(400), command(780), command(1260)]

  it('reads zero for the first entry of the series', () => {
    expect(elapsedSince(commands, commands[0])).toBe(0)
  })

  it('is the offset from the earliest entry', () => {
    expect(elapsedSince(commands, commands[1])).toBe(380)
    expect(elapsedSince(commands, commands[2])).toBe(860)
  })

  it('reads the same offset whatever order the series arrived in', () => {
    const reversed = [...commands].reverse()

    // The player's action tree indexes commands as delivered, so its series can
    // be unsorted — an offset taken from `entries[0]` would go negative here.
    expect(elapsedSince(reversed, commands[1])).toBe(380)
    expect(elapsedSince(reversed, commands[0])).toBe(0)
  })

  it('reads zero for a lone entry, which is its own baseline', () => {
    expect(elapsedSince([commands[1]], commands[1])).toBe(0)
  })

  it('reads zero against an empty series rather than a wall clock', () => {
    // Nothing to measure against, so the badge shows 0:00 — returning the raw
    // timestamp would render as a 53-year duration.
    expect(elapsedSince([], commands[1])).toBe(0)
  })

  it('keeps same-timestamp entries at the same offset', () => {
    const tied = [command(400), command(400), command(500)]

    expect(tied.map((entry) => elapsedSince(tied, entry))).toEqual([0, 0, 100])
  })

  it('times an entry against the series it is given, not against all of them', () => {
    // Why the series stays the caller's choice: the flat actions list times its
    // rows against the merged command + document-load list it renders, so its
    // first row always reads zero even when a document load precedes the first
    // command. The `show-command` emitters time the same command against the
    // commands alone, because their consumer badges actions.
    const merged = [documentLoad(120), ...commands]

    expect(elapsedSince(merged, commands[0])).toBe(280)
    expect(elapsedSince(commands, commands[0])).toBe(0)
  })
})
