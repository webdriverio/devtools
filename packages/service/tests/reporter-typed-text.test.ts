import { HookStats, TestStats } from '@wdio/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearTypedValues,
  configureInputMasking,
  maskCommandArgs
} from '@wdio/devtools-core'
import { MASKED_VALUE } from '@wdio/devtools-shared'

import { TestReporter } from '../src/reporter.js'

const SECRET = 'S3cret pass'

/** A failing `expect($('#password')).toHaveValue('x')`, as WebdriverIO's own TestStats carries it. */
function failedTest(): TestStats {
  const test = new TestStats({
    type: 'test:start',
    title: 'logs in',
    parent: 'login',
    fullTitle: 'login logs in',
    pending: false,
    cid: '0-0',
    specs: [],
    uid: 'u1',
    file: '/specs/login.spec.ts'
  })
  const err = Object.assign(
    new Error(
      `Expect $(\`#password\`) to have value\n\nExpected: "x"\nReceived: "${SECRET}"`
    ),
    {
      expected: 'x',
      actual: SECRET,
      matcherResult: { pass: false, message: `Received: "${SECRET}"` }
    }
  )
  test.fail([err])
  return test
}

afterEach(() => {
  clearTypedValues()
})

describe('a failed test’s error in the WebdriverIO test tree', () => {
  it('is stored scrubbed, so every later send of the tree stays scrubbed', () => {
    configureInputMasking()
    clearTypedValues()
    maskCommandArgs('webdriverio', 'setValue', [SECRET])
    const sendUpstream = vi.fn()
    const reporter = new TestReporter(
      { logFile: '/tmp/test.log' },
      sendUpstream
    )
    const test = failedTest()
    reporter.onTestStart(test)
    reporter.onTestEnd(test)

    // The next test's start forgets what was typed; the stored error must not need it any more.
    clearTypedValues()
    const stored = JSON.stringify([test.error, test.errors])
    expect(stored).not.toContain(SECRET)
    expect(stored).toContain(MASKED_VALUE)
    expect(test.title).toBe('logs in')
  })

  it('stores a failed hook’s error scrubbed, leaving the runner’s Error as it was', () => {
    configureInputMasking()
    clearTypedValues()
    maskCommandArgs('webdriverio', 'setValue', [SECRET])
    const reporter = new TestReporter({ logFile: '/tmp/test.log' }, vi.fn())
    const hook = new HookStats({
      type: 'hook:start',
      title: '"after each" hook',
      parent: 'login',
      fullTitle: 'login "after each" hook',
      cid: '0-0',
      uid: 'h1',
      file: '/specs/login.spec.ts'
    })
    const err = Object.assign(
      new Error('Expect $(`#password`) to have value'),
      {
        expected: 'x',
        actual: SECRET
      }
    )
    hook.complete([err])
    reporter.onHookStart(hook)
    reporter.onHookEnd(hook)

    clearTypedValues()
    const stored = JSON.stringify([hook.error, hook.errors])
    expect(stored).not.toContain(SECRET)
    expect(stored).toContain(MASKED_VALUE)
    expect(err.actual).toBe(SECRET)
  })
})
