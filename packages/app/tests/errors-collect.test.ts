import { describe, it, expect } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'

import { collectErrors } from '../src/components/workbench/errors/collect.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'

function command(overrides: Partial<CommandLog>): CommandLog {
  return {
    command: 'click',
    args: [],
    timestamp: 0,
    ...overrides
  }
}

function suiteMap(
  ...suites: SuiteStatsFragment[]
): Record<string, SuiteStatsFragment>[] {
  return [Object.fromEntries(suites.map((s) => [s.uid, s]))]
}

function failedTest(overrides: Partial<TestStatsFragment>): TestStatsFragment {
  return {
    uid: 't1',
    state: 'failed',
    ...overrides
  }
}

describe('collectErrors', () => {
  it('returns an empty list when nothing failed', () => {
    expect(collectErrors([], [])).toEqual([])
    expect(collectErrors(undefined, undefined)).toEqual([])
    expect(
      collectErrors(
        [command({ command: 'click' })],
        suiteMap({
          uid: 's1',
          state: 'passed',
          tests: [failedTest({ state: 'passed' })]
        })
      )
    ).toEqual([])
  })

  it('collects failed commands with title, message, stack and source', () => {
    const errors = collectErrors(
      [
        command({
          command: 'expect',
          title: 'expect(el).toHaveText',
          callSource: 'file:///spec.ts:12:3',
          error: {
            name: 'Error',
            message: 'expected foo, got bar',
            stack: 'at spec.ts:12'
          },
          timestamp: 100
        })
      ],
      []
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      title: 'expect(el).toHaveText',
      message: 'expected foo, got bar',
      stack: 'at spec.ts:12',
      callSource: 'file:///spec.ts:12:3',
      timestamp: 100
    })
    expect(errors[0].command?.command).toBe('expect')
  })

  it('falls back to the command name when there is no title', () => {
    const [error] = collectErrors(
      [
        command({
          command: 'navigateTo',
          error: { name: 'Error', message: 'boom' }
        })
      ],
      []
    )
    expect(error.title).toBe('navigateTo')
  })

  it('orders command errors by timestamp', () => {
    const errors = collectErrors(
      [
        command({
          command: 'second',
          error: { name: 'Error', message: 'b' },
          timestamp: 200
        }),
        command({
          command: 'first',
          error: { name: 'Error', message: 'a' },
          timestamp: 100
        })
      ],
      []
    )
    expect(errors.map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('collects failed tests from nested suites', () => {
    const errors = collectErrors(
      [],
      suiteMap({
        uid: 'feature',
        state: 'failed',
        suites: [
          {
            uid: 'scenario',
            state: 'failed',
            tests: [
              failedTest({
                uid: 'step-1',
                title: 'Then it should pass',
                fullTitle: 'Scenario > Then it should pass',
                callSource: 'steps.ts:8:1',
                error: { name: 'AssertionError', message: 'nope' }
              })
            ]
          }
        ]
      })
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      title: 'Scenario > Then it should pass',
      message: 'nope',
      callSource: 'steps.ts:8:1'
    })
    expect(errors[0].command).toBeUndefined()
  })

  it('reads the first entry of errors[] when error is absent', () => {
    const [error] = collectErrors(
      [],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'a',
            errors: [{ name: 'Error', message: 'from errors array' } as Error]
          })
        ]
      })
    )
    expect(error.message).toBe('from errors array')
  })

  it('ignores failed tests that carry no error payload', () => {
    const errors = collectErrors(
      [],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [failedTest({ uid: 'a' })]
      })
    )
    expect(errors).toEqual([])
  })

  it('dedupes a test failure that only echoes a command failure', () => {
    const shared = 'expect(locator).toHaveText failed'
    const errors = collectErrors(
      [
        command({
          command: 'expect',
          error: { name: 'Error', message: shared },
          timestamp: 5
        })
      ],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'a',
            title: 'the scenario',
            error: { name: 'Error', message: shared }
          })
        ]
      })
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].command?.command).toBe('expect')
  })

  it('dedupes a Cucumber assertion listed as both a command and a reworded test error', () => {
    // The matcher failure that expect-webdriverio reports: headline + diff.
    const matcherMessage =
      'Expect $(`#flash`) to have text\n\n' +
      'Expected: StringContaining "You logged into a secure area!"\n' +
      'Received: "Your username is invalid!"'
    const errors = collectErrors(
      [
        command({
          command: 'expect.toHaveText',
          title: 'expect.toHaveText',
          callSource: 'steps.ts:34:3',
          error: { name: 'Error', message: matcherMessage },
          timestamp: 50
        })
      ],
      suiteMap({
        uid: 'scenario',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'step',
            title: 'Then I should see a flash message',
            callSource: 'steps.ts:31',
            // Cucumber rebuilds the failed step's error from the first line of
            // the error's stack (so the headline gains an `Error:` prefix and
            // loses the diff) but keeps the full matcher output in `.stack`.
            error: {
              name: 'Error',
              message: 'Error: Expect to have text',
              stack: `Error: ${matcherMessage}\n    at World.<anonymous> (/steps.ts:34:3)`
            } as unknown as Error
          })
        ]
      })
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].command?.command).toBe('expect.toHaveText')
    expect(errors[0].actual).toBe('"Your username is invalid!"')
    expect(errors[0].expected).toBe(
      'StringContaining "You logged into a secure area!"'
    )
  })

  it('dedupes a Cucumber command failure whose test error only adds an Error: prefix', () => {
    const errors = collectErrors(
      [
        command({
          command: 'click',
          error: {
            name: 'Error',
            message: "Can't call click on element, it wasn't found"
          },
          timestamp: 5
        })
      ],
      suiteMap({
        uid: 'scenario',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'step',
            error: {
              name: 'Error',
              message: "Error: Can't call click on element, it wasn't found"
            }
          })
        ]
      })
    )
    expect(errors).toHaveLength(1)
    expect(errors[0].command?.command).toBe('click')
  })

  it('keeps a distinct test failure alongside command failures', () => {
    const errors = collectErrors(
      [
        command({
          command: 'click',
          error: { name: 'Error', message: 'click failed' },
          timestamp: 1
        })
      ],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'a',
            title: 'setup',
            error: { name: 'Error', message: 'hook failed' }
          })
        ]
      })
    )
    expect(errors.map((e) => e.message)).toEqual([
      'click failed',
      'hook failed'
    ])
  })

  it('dedupes failed tests by uid across repeated suite maps', () => {
    const test = failedTest({
      uid: 'dup',
      title: 'flaky',
      error: { name: 'Error', message: 'x' }
    })
    const errors = collectErrors(
      [],
      [
        { s: { uid: 's', state: 'failed', tests: [test] } },
        { s: { uid: 's', state: 'failed', tests: [test] } }
      ]
    )
    expect(errors).toHaveLength(1)
  })

  it('strips ANSI, splits the stack, and pulls Expected/Received from a cucumber message', () => {
    const raw =
      'Expect $(`#flash`) to have text\n\n' +
      'Expected: [32mStringContaining "secure area"[39m\n' +
      'Received: [31m"invalid"[39m\n' +
      '    at World.<anonymous> (/specs/steps.ts:31:20)\n' +
      '    at process.processTicksAndRejections (node:internal:104:5)'
    const [error] = collectErrors(
      [
        command({
          command: 'expect.assertion',
          error: { name: 'Error', message: raw }
        })
      ],
      []
    )
    expect(error.message).toBe('Expect $(`#flash`) to have text')
    expect(error.expected).toBe('StringContaining "secure area"')
    expect(error.actual).toBe('"invalid"')
    expect(error.stack).toContain('at World.<anonymous>')
    expect(error.message).not.toContain('')
    expect(error.message).not.toContain('at World')
  })

  it('extracts indented Expected/Received and dedents the value', () => {
    const raw =
      'Expect $(`#flash`) to have text\n\n' +
      '                    Expected: StringContaining "secure area"\n' +
      '                    Received: "invalid!\n×"\n' +
      '    at World.<anonymous> (/specs/steps.ts:31:20)'
    const [error] = collectErrors(
      [command({ command: 'getText', error: { name: 'Error', message: raw } })],
      []
    )
    expect(error.message).toBe('Expect $(`#flash`) to have text')
    expect(error.expected).toBe('StringContaining "secure area"')
    expect(error.actual).toBe('"invalid!\n×"')
    expect(error.stack).toContain('at World.<anonymous>')
  })

  it('extracts expected/received from an assertion command', () => {
    const [error] = collectErrors(
      [
        command({
          command: 'expect.toHaveText',
          args: ['Your username is invalid!', 'You logged into a secure area!'],
          error: { name: 'Error', message: 'text mismatch' }
        })
      ],
      []
    )
    expect(error.actual).toBe('Your username is invalid!')
    expect(error.expected).toBe('You logged into a secure area!')
  })

  it('extracts expected/received from a failed-test matcher error', () => {
    const [error] = collectErrors(
      [],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [
          failedTest({
            uid: 'a',
            title: 'the scenario',
            error: {
              name: 'Error',
              message: 'mismatch',
              expected: 42,
              actual: 7
            } as unknown as Error
          })
        ]
      })
    )
    expect(error.expected).toBe('42')
    expect(error.actual).toBe('7')
  })

  it('places command errors before test errors', () => {
    const errors = collectErrors(
      [
        command({
          command: 'click',
          error: { name: 'Error', message: 'cmd' },
          timestamp: 999
        })
      ],
      suiteMap({
        uid: 's',
        state: 'failed',
        tests: [
          failedTest({ uid: 'a', error: { name: 'Error', message: 'test' } })
        ]
      })
    )
    expect(errors.map((e) => e.message)).toEqual(['cmd', 'test'])
  })
})
