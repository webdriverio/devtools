import {
  maskCommandArgs,
  RetryTracker,
  rememberReadValue,
  scrubTypedText,
  selectorForReadValue
} from '@wdio/devtools-core'
import { MASKED_VALUE } from '@wdio/devtools-shared'
import { describe, expect, it, vi } from 'vitest'

import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
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

describe('typed values are scoped to a test', () => {
  it('forgets what was typed when a test or a scenario starts', () => {
    const ctx = makeCtx()
    maskCommandArgs('selenium-webdriver', 'sendKeys', ['S3cret pass'])
    startTest(ctx, 'next', { file: '/specs/a.spec.ts' })
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
    maskCommandArgs('selenium-webdriver', 'sendKeys', ['S3cret pass'])
    startScenario(ctx, 'next', { file: '/features/a.feature' })
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
  })
})

describe('a capture still in flight when the next test starts', () => {
  it('is scrubbed against what its own test typed', async () => {
    const capturer = new SessionCapturer({})
    try {
      const ctx = { ...makeCtx(), sessionCapturer: capturer }
      maskCommandArgs('selenium-webdriver', 'sendKeys', ['S3cret pass'])
      // The last row of test 1, still waiting on its screenshot when test 2 starts.
      let screenshot!: () => void
      const row = {
        command: 'getAttribute',
        args: ['value'],
        result: 'S3cret pass',
        timestamp: 1
      }
      capturer.track(
        new Promise<void>((resolve) => {
          screenshot = resolve
        }).then(() => {
          capturer.sendCommand(row)
        })
      )
      startTest(ctx, 'second', { file: '/specs/a.spec.ts' })
      maskCommandArgs('selenium-webdriver', 'sendKeys', ['next-test value'])
      screenshot()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(row.result).toBe(MASKED_VALUE)
      expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
      expect(scrubTypedText('next-test value')).toBe(MASKED_VALUE)
    } finally {
      capturer.cleanup()
    }
  })
})
