import type { RunnerHookCallbacks } from './types.js'
import { tryRegisterMochaHooks } from './runnerHooks/mocha.js'
import { tryRegisterJestHooks } from './runnerHooks/jest.js'
import { tryRegisterCucumberHooks } from './runnerHooks/cucumber.js'

export { tryRegisterMochaHooks, tryRegisterJestHooks, tryRegisterCucumberHooks }

// Jest is identified by `expect.getState()` (Chai's `expect` lacks it).
// Mocha is identified by `it`+`describe`+`beforeEach` without that.
// Cucumber doesn't expose globals — we detect via argv + a require probe.
export function detectRunner(): 'jest' | 'mocha' | 'cucumber' | null {
  const g = globalThis as any
  if ((process.argv[1] || '').toLowerCase().includes('cucumber')) {
    return 'cucumber'
  }
  const hasBeforeEach = typeof g.beforeEach === 'function'
  if (!hasBeforeEach) {
    return null
  }
  if (typeof g.expect?.getState === 'function') {
    return 'jest'
  }
  if (typeof g.it === 'function' && typeof g.describe === 'function') {
    return 'mocha'
  }
  return null
}

export function tryRegisterRunnerHooks(
  callbacks: RunnerHookCallbacks
): 'jest' | 'mocha' | 'cucumber' | false {
  const runner = detectRunner()
  if (runner === 'jest') {
    return tryRegisterJestHooks(callbacks) ? 'jest' : false
  }
  if (runner === 'mocha') {
    return tryRegisterMochaHooks(callbacks) ? 'mocha' : false
  }
  if (runner === 'cucumber') {
    return tryRegisterCucumberHooks(callbacks) ? 'cucumber' : false
  }
  return false
}
