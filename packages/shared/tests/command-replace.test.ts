import { describe, expect, it } from 'vitest'

import { replaceCommand, replaceCommandIndex } from '../src/command-replace.js'
import type { CommandLog } from '../src/types.js'

const row = (command: string, timestamp: number, id?: number): CommandLog => ({
  command,
  args: [],
  timestamp,
  ...(id === undefined ? {} : { id })
})

describe('replaceCommand', () => {
  // Regression: two rows completing in one millisecond, matched by timestamp
  // alone, sent the second row's update onto the first and erased it.
  it('targets the row by id when two rows share a timestamp', () => {
    const current = [row('sendKeys', 42, 4), row('findElement', 42, 5)]
    const next = replaceCommand(current, 42, row('findElement', 42, 5))
    expect(next.map((r) => r.command)).toEqual(['sendKeys', 'findElement'])
  })

  it('falls back to the last row with the old timestamp', () => {
    const current = [row('a', 42), row('b', 42)]
    expect(replaceCommandIndex(current, 42, row('c', 42))).toBe(1)
  })

  it('appends when nothing matches', () => {
    const next = replaceCommand([row('a', 1)], 999, row('b', 999))
    expect(next.map((r) => r.command)).toEqual(['a', 'b'])
  })

  it('does not mutate the list it was given', () => {
    const current = [row('a', 1, 1)]
    replaceCommand(current, 1, row('b', 1, 1))
    expect(current[0].command).toBe('a')
  })
})
