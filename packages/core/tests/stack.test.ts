import { describe, it, expect } from 'vitest'
import { isAssertFromUserCode } from '@wdio/devtools-core'

// Synthetic V8 stacks as captured INSIDE patchedAssert: frames[0] is the
// wrapper (any name — may be minified), frames[1] is whoever called the assert.
const stackWithCaller = (callerFile: string, wrapperName = 'patchedAssert') =>
  [
    'Error',
    `    at ${wrapperName} (/repo/packages/core/src/assert-patcher.ts:158:30)`,
    `    at Object.<anonymous> (${callerFile}:5:10)`,
    '    at Module._compile (node:internal/modules/cjs/loader:1234:14)'
  ].join('\n')

describe('isAssertFromUserCode', () => {
  it('keeps an assert whose immediate caller is user code', () => {
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/tests/login.spec.ts'))
    ).toBe(true)
  })

  it('drops an assert fired by a dependency during a user operation', () => {
    expect(
      isAssertFromUserCode(
        stackWithCaller('/repo/node_modules/webdriverio/build/session.js')
      )
    ).toBe(false)
  })

  it('drops one whose immediate caller is bundled dist output', () => {
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/packages/core/dist/x.js'))
    ).toBe(false)
  })

  it('works regardless of the wrapper frame name (minified bundle)', () => {
    // The wrapper is renamed by the bundler; the fixed frame offset still holds.
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/tests/login.spec.ts', 'n2'))
    ).toBe(true)
    expect(
      isAssertFromUserCode(stackWithCaller('/repo/node_modules/x/i.js', 'n2'))
    ).toBe(false)
  })

  it('returns true when there is no stack', () => {
    expect(isAssertFromUserCode(undefined)).toBe(true)
  })
})
