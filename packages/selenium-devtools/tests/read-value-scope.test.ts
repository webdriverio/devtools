import {
  RetryTracker,
  rememberReadValue,
  selectorForReadValue
} from '@wdio/devtools-core'
import { describe, expect, it, vi } from 'vitest'

import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import {
  startScenario,
  startTest,
  type TestManagementCtx
} from '../src/test-management.js'

function makeCtx(): TestManagementCtx {
  const testReporter = new TestReporter(vi.fn())
  return {
    retryTracker: new RetryTracker(),
    testReporter,
    sessionCapturer: undefined,
    suiteManager: new SuiteManager(testReporter),
    testManager: undefined,
    testFilePath: undefined,
    pendingTestActions: [],
    pendingScenario: null
  }
}

// Regression: the value registry outlived the test that read a value, so a later test's assert.ok(true) boxed it.
describe('read-value provenance is scoped to a test', () => {
  it('forgets values when a test starts (mocha, jest, a plain script calling startTest)', () => {
    const ctx = makeCtx()
    startTest(ctx, 'first', { file: '/specs/a.spec.ts' })
    rememberReadValue(true, '#remember-me')
    startTest(ctx, 'second', { file: '/specs/a.spec.ts' })
    expect(selectorForReadValue(true)).toBeUndefined()
  })

  it('forgets values when a cucumber scenario starts', () => {
    const ctx = makeCtx()
    startScenario(ctx, 'first', { file: '/features/a.feature' })
    rememberReadValue(true, '#remember-me')
    startScenario(ctx, 'second', { file: '/features/a.feature' })
    expect(selectorForReadValue(true)).toBeUndefined()
  })

  it('keeps values read within the test', () => {
    const ctx = makeCtx()
    startTest(ctx, 'only', { file: '/specs/a.spec.ts' })
    rememberReadValue(true, '#remember-me')
    expect(selectorForReadValue(true)).toBe('#remember-me')
  })
})
