import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunnerHookCallbacks } from '../src/types.js'

const MOCHA_GLOBALS = [
  'beforeEach',
  'afterEach',
  'before',
  'after',
  'it',
  'describe'
]

function callbacks(): RunnerHookCallbacks {
  return {
    onTestStart: vi.fn(),
    onTestEnd: vi.fn(async () => {}),
    onScenarioStart: vi.fn(),
    onScenarioEnd: vi.fn(async () => {}),
    onTestRunComplete: vi.fn()
  }
}

// The runner's own globals are swapped out so detection sees only what a test installs.
const g = globalThis as Record<string, unknown>
const saved = new Map<string, unknown>()
beforeEach(() => {
  for (const name of [...MOCHA_GLOBALS, 'expect']) {
    saved.set(name, g[name])
    delete g[name]
  }
})
afterEach(() => {
  for (const [name, value] of saved) {
    g[name] = value
  }
  vi.resetModules()
})

describe('mocha root hooks', () => {
  it('starts the first test even when it runs before the mocha globals were polled', async () => {
    // Under `--require` the plugin loads before mocha publishes its globals.
    const { claimMochaRootHooks, tryRegisterRunnerHooks } =
      await import('../src/runnerHooks.js')
    const cb = callbacks()
    expect(tryRegisterRunnerHooks(cb)).toBe(false)

    // Mocha reads `mochaHooks` before loading a spec, so nothing is left to a poll.
    const hooks = claimMochaRootHooks(cb)
    hooks.beforeAll()
    hooks.beforeEach.call({
      currentTest: { title: 'first', file: '/spec.js', parent: { title: '' } }
    })
    expect(cb.onTestStart).toHaveBeenCalledWith(
      'first',
      '/spec.js',
      '/spec.js:0',
      undefined,
      undefined,
      undefined
    )

    // The globals appearing later must not register a second set of hooks.
    for (const name of MOCHA_GLOBALS) {
      g[name] = vi.fn()
    }
    expect(tryRegisterRunnerHooks(cb)).toBe('mocha')
    expect(g.beforeEach).not.toHaveBeenCalled()
    expect(g.afterEach).not.toHaveBeenCalled()
  })

  it('is what the package entry hands mocha under --require', async () => {
    const entry = await import('../src/index.js')
    const hooks = entry.mochaHooks()
    expect(Object.keys(hooks).sort()).toEqual([
      'afterAll',
      'afterEach',
      'beforeAll',
      'beforeEach'
    ])
  })

  it('still registers through the globals when mocha never reads mochaHooks', async () => {
    const { tryRegisterRunnerHooks } = await import('../src/runnerHooks.js')
    for (const name of MOCHA_GLOBALS) {
      g[name] = vi.fn()
    }
    expect(tryRegisterRunnerHooks(callbacks())).toBe('mocha')
    expect(g.beforeEach).toHaveBeenCalledTimes(1)
    expect(g.afterEach).toHaveBeenCalledTimes(1)
  })
})
