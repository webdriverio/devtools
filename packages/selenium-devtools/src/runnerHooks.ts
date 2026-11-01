import logger from '@wdio/logger'
import type { MochaRootHooks, RunnerHookCallbacks } from './types.js'
import {
  buildMochaRootHooks,
  tryRegisterMochaHooks
} from './runnerHooks/mocha.js'
import { tryRegisterJestHooks } from './runnerHooks/jest.js'
import { tryRegisterCucumberHooks } from './runnerHooks/cucumber.js'

export { tryRegisterMochaHooks, tryRegisterJestHooks, tryRegisterCucumberHooks }

const log = logger('@wdio/selenium-devtools:runnerHooks')

// Jest is identified by `expect.getState()` (Chai's `expect` lacks it).
// Mocha is identified by `it`+`describe`+`beforeEach` without that.
// Cucumber doesn't expose globals — we detect via argv + a require probe.
export function detectRunner(): 'jest' | 'mocha' | 'cucumber' | null {
  // Double-cast: built-in `globalThis` lacks the runner globals; kept local
  // (not `declare global`) so consumers don't get them as ambient types.
  const g = globalThis as unknown as {
    beforeEach?: unknown
    expect?: { getState?: unknown }
    it?: unknown
    describe?: unknown
  }
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

let mochaRootHooksClaimed = false

/** Mocha reads this under `--require` before any spec loads, so the first test's `beforeEach` cannot be missed. */
export function claimMochaRootHooks(
  callbacks: RunnerHookCallbacks
): MochaRootHooks {
  mochaRootHooksClaimed = true
  log.info('✓ Mocha root hooks registered (--require)')
  return buildMochaRootHooks(callbacks)
}

export function tryRegisterRunnerHooks(
  callbacks: RunnerHookCallbacks
): 'jest' | 'mocha' | 'cucumber' | false {
  if (mochaRootHooksClaimed) {
    return 'mocha'
  }
  const detectedRunner = detectRunner()
  if (detectedRunner === 'jest') {
    return tryRegisterJestHooks(callbacks) ? 'jest' : false
  }
  if (detectedRunner === 'mocha') {
    return tryRegisterMochaHooks(callbacks) ? 'mocha' : false
  }
  if (detectedRunner === 'cucumber') {
    return tryRegisterCucumberHooks(callbacks) ? 'cucumber' : false
  }
  return false
}
