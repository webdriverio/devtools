import { describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import { mutationForCommand } from '../src/components/browser/mutation-at-command.js'

// TraceMutation is the browser-side global (packages/script/types.d.ts), the
// same type mutation-at-command.ts operates on.

function mut(timestamp: number): TraceMutation {
  return { type: 'childList', addedNodes: [], removedNodes: [], timestamp }
}

function cmd(timestamp: number, startTime?: number): CommandLog {
  return { command: 'click', args: [], timestamp, startTime } as CommandLog
}

describe('mutationForCommand', () => {
  // Mutations trail their command, so a command's RESULT is the last mutation
  // before the NEXT command starts.
  const mutations = [mut(100), mut(210), mut(215), mut(320)]

  it('returns the last mutation before the next command starts', () => {
    const c1 = cmd(90)
    const c2 = cmd(200)
    // c1's result is the state just before c2 begins: mut(100), not mut(210+)
    // which belong to c2's navigation.
    expect(mutationForCommand(c1, [c1, c2], mutations)).toBe(mutations[0])
  })

  it('prefers startTime over timestamp for the next command bound', () => {
    const c1 = cmd(90)
    const c2 = cmd(400, 300) // starts at 300 despite a later timestamp
    // Everything before 300 is c1's result → mut(215).
    expect(mutationForCommand(c1, [c1, c2], mutations)).toBe(mutations[2])
  })

  it('uses the last captured mutation for the final command (no upper bound)', () => {
    const last = cmd(300)
    expect(mutationForCommand(last, [cmd(90), last], mutations)).toBe(
      mutations[3]
    )
  })

  it('falls back to the first mutation when the next command bounds out every mutation', () => {
    // early's slice ends when c2 starts (t=50), but the first mutation is at
    // t=100 — nothing qualifies, so it shows the slice's initial DOM.
    const early = cmd(10)
    const c2 = cmd(50)
    expect(
      mutationForCommand(early, [early, c2], [mut(100), mut(200)])
    ).toEqual(mut(100))
  })

  it('resolves the window of a command captured at timestamp 0', () => {
    // `CommandLog.timestamp` is required and 0 is reachable — the first command
    // of a normalized or standalone trace. Read for truthiness it bails out and
    // the snapshot player is handed no DOM at all for that command.
    const first = cmd(0, 0)
    const second = cmd(300, 250)
    expect(mutationForCommand(first, [first, second], mutations)).toBe(
      mutations[2]
    )
  })

  it('returns undefined without a command or without mutations', () => {
    expect(mutationForCommand(undefined, [], mutations)).toBeUndefined()
    expect(mutationForCommand(cmd(100), [], [])).toBeUndefined()
  })
})
