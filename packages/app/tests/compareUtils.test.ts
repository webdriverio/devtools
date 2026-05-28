import { describe, it, expect } from 'vitest'

import {
  pairSteps,
  commandsEqual,
  classifyDivergence,
  extractExpectedFromStepText,
  safeJson
} from '../src/components/workbench/compare/compareUtils.js'

const cmd = (
  command: string,
  args: unknown[] = [],
  extra: Record<string, unknown> = {}
) =>
  ({
    command,
    args,
    result: null,
    timestamp: 0,
    callSource: '',
    ...extra
  }) as never

describe('compareUtils', () => {
  it('commandsEqual ignores `result` (W3C element refs drift across sessions) but catches command/args/error diffs', () => {
    // Identical → equal
    expect(commandsEqual(cmd('url', ['/a']), cmd('url', ['/a']))).toBe(true)
    // Same call but a different element-ref in result → still equal
    const refA = cmd('$', ['#x'], {
      result: { 'element-6066-11e4-a52e-4f735466cecf': 'a' }
    })
    const refB = cmd('$', ['#x'], {
      result: { 'element-6066-11e4-a52e-4f735466cecf': 'b' }
    })
    expect(commandsEqual(refA, refB)).toBe(true)
    // Real divergences
    expect(commandsEqual(cmd('url'), cmd('click'))).toBe(false)
    expect(commandsEqual(cmd('url', ['/a']), cmd('url', ['/b']))).toBe(false)
    expect(
      commandsEqual(
        cmd('click', [], { error: { message: 'boom' } }),
        cmd('click')
      )
    ).toBe(false)
    // Missing side
    expect(commandsEqual(undefined, cmd('url'))).toBe(false)
  })

  it('classifyDivergence labels every kind correctly', () => {
    expect(classifyDivergence(cmd('url'), cmd('url'))).toBe('none')
    expect(classifyDivergence(cmd('url'), undefined)).toBe('missing')
    expect(classifyDivergence(cmd('url'), cmd('click'))).toBe('commandName')
    expect(classifyDivergence(cmd('url', ['/a']), cmd('url', ['/b']))).toBe(
      'args'
    )
    expect(
      classifyDivergence(
        cmd('click', [], { error: { message: 'boom' } }),
        cmd('click')
      )
    ).toBe('error')
  })

  it('pairSteps locks the fork bit once execution diverges and handles uneven lengths', () => {
    const pairs = pairSteps(
      [cmd('url'), cmd('a'), cmd('b'), cmd('c')],
      [cmd('url'), cmd('X'), cmd('Y')]
    )
    expect(pairs.map((p) => p.divergent)).toEqual([false, true, true, true])
    expect(pairs[3].baseline?.command).toBe('c')
    expect(pairs[3].latest).toBeUndefined()
  })

  it('extractExpectedFromStepText pulls the parameterized tail from Cucumber Then steps', () => {
    expect(
      extractExpectedFromStepText(
        '1: Then I should see a flash message saying You logged in!'
      )
    ).toBe('You logged in!')
    expect(extractExpectedFromStepText('')).toBeUndefined()
  })

  it('safeJson stringifies, truncates long output, and survives cyclic refs', () => {
    expect(safeJson({ a: 1 })).toBe('{"a":1}')
    const truncated = safeJson('x'.repeat(2000))
    expect(truncated.endsWith('…')).toBe(true)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(safeJson(cyclic)).toBe('[object Object]')
  })
})
