import { describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  afterStep: undefined as ((arg: unknown) => void | Promise<void>) | undefined
}))

vi.mock('node:module', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRequire: () => () => ({
    Before: vi.fn(),
    After: vi.fn(),
    BeforeAll: vi.fn(),
    AfterAll: vi.fn(),
    BeforeStep: vi.fn(),
    AfterStep: (fn: (arg: unknown) => void | Promise<void>) => {
      hooks.afterStep = fn
    }
  })
}))

import { tryRegisterCucumberHooks } from '../src/runnerHooks/cucumber.js'

describe('cucumber AfterStep', () => {
  // Regression: unawaited, the next step recorded its trace boundary while this step's native drain was in flight.
  it('waits for the step end before cucumber moves on to the next step', async () => {
    let release: () => void = () => {}
    const onTestEnd = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    expect(tryRegisterCucumberHooks({ onTestStart: vi.fn(), onTestEnd })).toBe(
      true
    )

    let settled = false
    const done = Promise.resolve(
      hooks.afterStep?.({ result: { status: 'PASSED' } })
    ).then(() => (settled = true))
    await Promise.resolve()
    expect(onTestEnd).toHaveBeenCalledWith('passed')
    expect(settled).toBe(false)

    release()
    await done
    expect(settled).toBe(true)
  })
})
