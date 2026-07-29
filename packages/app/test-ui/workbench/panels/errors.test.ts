import type { CommandLog } from '@wdio/devtools-shared'

import { commandContext, suiteContext } from '@/controller/context.js'
import type { SuiteStatsFragment } from '@/controller/types.js'
import '@components/workbench/errors.js'
import type { DevtoolsErrors } from '@components/workbench/errors.js'

import { mount, mountWithContext, settle } from '../../support/mount.js'
import { commandLog } from '../../support/builders.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  ASSERT_ACTUAL,
  ASSERT_EXPECTED,
  CLICK_MESSAGE,
  HOOK_MESSAGE,
  MATCHER_EXPECTED,
  MATCHER_HEADLINE,
  MATCHER_RECEIVED,
  RUN_START,
  SPEC_FILE,
  STACK_FRAMES,
  capturedError,
  loginErrors,
  suiteFragment,
  suiteRegistry,
  testError,
  testFragment
} from './fixtures.js'

const PANEL = 'wdio-devtools-errors'
const ENTRY = '.error-entry'
const LOC = '.error-loc'
const TITLE = '.error-title'
const DIFF = '.error-diff'
const DIFF_LABEL = '.error-diff .label'
const RECEIVED = '.error-diff .received'
const EXPECTED = '.error-diff .expected'
const STACK = '.error-stack'
const STACK_BODY = '.error-stack pre'
const STACK_SUMMARY = '.error-stack summary'
const EMPTY_STATE = '.empty-state'
const EMPTY_ICON = '.empty-state-icon'

/** Anchor labels of the scenario's failures — `@` plus the last three path
 *  segments of each call source, which is all the anchor shows. */
const ANCHOR = {
  click: '@test/specs/login.e2e.ts:9:36',
  matcher: '@test/specs/login.e2e.ts:10:11',
  nativeAssert: '@test/specs/login.e2e.ts:11:12',
  hook: '@test/specs/login.e2e.ts:14:3'
}

async function mountErrors(
  commands: CommandLog[],
  suites: Record<string, SuiteStatsFragment>[] = []
): Promise<DevtoolsErrors> {
  const panel = await mountWithContext<DevtoolsErrors>(PANEL, [
    { context: commandContext, value: commands },
    { context: suiteContext, value: suites }
  ])
  await settle(panel)
  return panel
}

const entries = (panel: DevtoolsErrors) => shadowAll(panel, ENTRY)

/** Raw lines of an element's text — `text()` collapses the newlines a wrapped
 *  message and a stack are made of. */
const lines = (el: Element | null): string[] =>
  (el?.textContent ?? '')
    .trim()
    .split('\n')
    .map((line) => line.trim())

function failingCommand(
  message: string,
  overrides: Partial<CommandLog> = {}
): CommandLog {
  return commandLog({
    command: 'click',
    error: capturedError(message),
    ...overrides
  })
}

describe('wdio-devtools-errors', () => {
  describe('error list', () => {
    it('renders one entry per failing command', async () => {
      const panel = await mountErrors(loginErrors.commands)

      expect(entries(panel)).toHaveLength(3)
    })

    it('skips the commands that succeeded', async () => {
      const panel = await mountErrors([loginErrors.navigate])

      expect(entries(panel)).toHaveLength(0)
      expect(text(shadow(panel, EMPTY_STATE))).toBe('✓ No errors')
    })

    it('orders command failures by the time they were captured', async () => {
      const panel = await mountErrors(loginErrors.commands)

      expect(texts(panel, LOC)).toEqual([
        ANCHOR.click,
        ANCHOR.matcher,
        ANCHOR.nativeAssert
      ])
    })

    it('lists the failures a suite reported after the command failures', async () => {
      const panel = await mountErrors(loginErrors.commands, loginErrors.suites)

      expect(entries(panel)).toHaveLength(4)
      expect(texts(panel, LOC)).toEqual([
        ANCHOR.click,
        ANCHOR.matcher,
        ANCHOR.nativeAssert,
        ANCHOR.hook
      ])
    })

    it('ignores a test that carries an error but did not fail', async () => {
      const panel = await mountErrors([], loginErrors.suites)

      // The scenario's passing test carries a retry error; only the failed one
      // becomes a row.
      expect(entries(panel)).toHaveLength(1)
      expect(text(shadow(panel, TITLE))).toBe(HOOK_MESSAGE)
    })

    it('walks nested suites for failed tests', async () => {
      const panel = await mountErrors(
        [],
        suiteRegistry(
          suiteFragment('feature', {
            suites: [
              suiteFragment('scenario', {
                tests: [
                  testFragment('deep', { error: testError('nested failure') })
                ]
              })
            ]
          })
        )
      )

      expect(text(shadow(panel, TITLE))).toBe('nested failure')
    })

    it('keeps the freshest fragment when the same test uid failed twice', async () => {
      const failed = (message: string) =>
        suiteFragment('login-suite', {
          tests: [testFragment('login-logout', { error: testError(message) })]
        })
      const panel = await mountErrors(
        [],
        [
          ...suiteRegistry(failed('first report')),
          ...suiteRegistry(failed('corrected report'))
        ]
      )

      expect(texts(panel, TITLE)).toEqual(['corrected report'])
    })

    it('renders no entry for a failure carrying neither message nor stack', async () => {
      const panel = await mountErrors([
        commandLog({ error: capturedError('', { name: '' }) })
      ])

      expect(entries(panel)).toHaveLength(0)
    })
  })

  describe('de-duplication', () => {
    it('drops a failed test that only re-reports a command failure', async () => {
      const panel = await mountErrors(
        [loginErrors.click],
        suiteRegistry(
          suiteFragment('login-suite', {
            tests: [
              testFragment('login-valid', { error: testError(CLICK_MESSAGE) })
            ]
          })
        )
      )

      expect(entries(panel)).toHaveLength(1)
      expect(text(shadow(panel, LOC))).toBe(ANCHOR.click)
    })

    it('drops a failed test whose message only adds the framework Error prefix', async () => {
      const panel = await mountErrors(
        [loginErrors.click],
        suiteRegistry(
          suiteFragment('login-suite', {
            tests: [
              testFragment('login-valid', {
                error: testError(`Error: ${CLICK_MESSAGE}`)
              })
            ]
          })
        )
      )

      expect(entries(panel)).toHaveLength(1)
    })

    it("drops a failed test that echoes a command's assertion values in its stack", async () => {
      const panel = await mountErrors(
        [loginErrors.nativeAssert],
        suiteRegistry(
          suiteFragment('login-suite', {
            tests: [
              testFragment('login-valid', {
                // Reworded headline, so only the expected+actual echo can match.
                error: testError(
                  'Error: assertion failed',
                  `AssertionError: expected '${ASSERT_ACTUAL}' to equal '${ASSERT_EXPECTED}'\n${STACK_FRAMES.join('\n')}`
                )
              })
            ]
          })
        )
      )

      expect(entries(panel)).toHaveLength(1)
      expect(text(shadow(panel, LOC))).toBe(ANCHOR.nativeAssert)
    })

    it('keeps a failed test whose own failure no command reported', async () => {
      const panel = await mountErrors([loginErrors.click], loginErrors.suites)

      expect(texts(panel, TITLE)).toEqual([CLICK_MESSAGE, HOOK_MESSAGE])
    })

    it('renders a repeated failure once per command rather than grouping it', async () => {
      const panel = await mountErrors([
        failingCommand('Timeout of 5000ms exceeded', { timestamp: RUN_START }),
        failingCommand('Timeout of 5000ms exceeded', {
          timestamp: RUN_START + 400
        })
      ])

      expect(texts(panel, TITLE)).toEqual([
        'Timeout of 5000ms exceeded',
        'Timeout of 5000ms exceeded'
      ])
    })
  })

  describe('assertion diff', () => {
    it("renders a matcher failure's Expected and Received values as a labelled diff", async () => {
      const panel = await mountErrors([loginErrors.matcher])

      expect(texts(panel, DIFF_LABEL)).toEqual(['Actual', 'Expected'])
      // The matcher printed its own values, and the panel quotes any string
      // value again — so they arrive doubly quoted.
      expect(text(shadow(panel, RECEIVED))).toBe(`'${MATCHER_RECEIVED}'`)
      expect(text(shadow(panel, EXPECTED))).toBe(`'${MATCHER_EXPECTED}'`)
    })

    it('drops the matcher headline once its values have been pulled out', async () => {
      const panel = await mountErrors([loginErrors.matcher])

      expect(shadowAll(panel, TITLE)).toHaveLength(0)
      // The headline survives only inside the stack the entry also renders.
      expect(text(shadow(panel, STACK_BODY))).toContain(MATCHER_HEADLINE)
    })

    it('reads the values off a collapsed assert result when the command carries one', async () => {
      const panel = await mountErrors([loginErrors.nativeAssert])

      expect(text(shadow(panel, RECEIVED))).toBe(`'${ASSERT_ACTUAL}'`)
      expect(text(shadow(panel, EXPECTED))).toBe(`'${ASSERT_EXPECTED}'`)
    })

    it('falls back to the positional args of an assertion command with no result', async () => {
      const panel = await mountErrors([
        commandLog({
          command: 'verify.equal',
          args: [ASSERT_ACTUAL, ASSERT_EXPECTED],
          error: capturedError('verify.equal failed')
        })
      ])

      expect(text(shadow(panel, RECEIVED))).toBe(`'${ASSERT_ACTUAL}'`)
      expect(text(shadow(panel, EXPECTED))).toBe(`'${ASSERT_EXPECTED}'`)
    })

    it('reads the values off the error itself when nothing else carries them', async () => {
      const panel = await mountErrors([
        commandLog({
          command: 'getTitle',
          args: [],
          error: Object.assign(new Error('title mismatch'), {
            expected: ASSERT_EXPECTED,
            actual: ASSERT_ACTUAL
          })
        })
      ])

      expect(text(shadow(panel, RECEIVED))).toBe(`'${ASSERT_ACTUAL}'`)
      expect(text(shadow(panel, EXPECTED))).toBe(`'${ASSERT_EXPECTED}'`)
    })

    it('renders only the row it has a value for', async () => {
      const panel = await mountErrors([
        commandLog({
          command: 'assert.ok',
          args: [false],
          result: { passed: false, actual: ASSERT_ACTUAL },
          error: capturedError('assert.ok failed')
        })
      ])

      expect(texts(panel, DIFF_LABEL)).toEqual(['Actual'])
      expect(shadowAll(panel, EXPECTED)).toHaveLength(0)
    })

    it('renders no diff for a failure that carried no values', async () => {
      const panel = await mountErrors([loginErrors.click])

      expect(shadowAll(panel, DIFF)).toHaveLength(0)
      expect(text(shadow(panel, TITLE))).toBe(CLICK_MESSAGE)
    })
  })

  describe('stack', () => {
    it('renders the captured stack in a collapsed Stack section', async () => {
      const panel = await mountErrors([loginErrors.click])

      const details = shadow<HTMLDetailsElement>(panel, STACK)
      expect(text(shadow(panel, STACK_SUMMARY))).toBe('Stack')
      expect(details?.open).toBe(false)
      expect(lines(shadow(panel, STACK_BODY))).toEqual([
        `Error: ${CLICK_MESSAGE}`,
        ...STACK_FRAMES.map((frame) => frame.trim())
      ])
    })

    it('renders no stack section for a failure captured without one', async () => {
      const panel = await mountErrors([loginErrors.nativeAssert])

      expect(shadowAll(panel, STACK)).toHaveLength(0)
      expect(entries(panel)).toHaveLength(1)
    })

    it('splits trailing stack frames off a message that carries its own', async () => {
      const panel = await mountErrors([
        failingCommand(`element not interactable\n${STACK_FRAMES.join('\n')}`)
      ])

      expect(text(shadow(panel, TITLE))).toBe('element not interactable')
      expect(lines(shadow(panel, STACK_BODY))).toEqual(
        STACK_FRAMES.map((frame) => frame.trim())
      )
    })

    it('reports a bare Error when the message was only stack frames', async () => {
      const panel = await mountErrors([failingCommand(STACK_FRAMES.join('\n'))])

      expect(text(shadow(panel, TITLE))).toBe('Error')
      expect(shadowAll(panel, STACK)).toHaveLength(1)
    })
  })

  describe('message', () => {
    // The `\u001b` prefixes are load-bearing: `stripAnsi` matches `ESC[<n>m`, so
    // a colour code that reached the app without its ESC stays in the row.
    it('strips terminal colour codes from the message', async () => {
      const panel = await mountErrors([
        failingCommand('\u001b[31mTimeout\u001b[39m of 5000ms exceeded')
      ])

      expect(text(shadow(panel, TITLE))).toBe('Timeout of 5000ms exceeded')
    })

    it('strips terminal colour codes from the stack', async () => {
      const panel = await mountErrors([
        commandLog({
          error: capturedError('Timeout of 5000ms exceeded', {
            stack: `Error: Timeout\n\u001b[90m${STACK_FRAMES[0]}\u001b[39m`
          })
        })
      ])

      expect(lines(shadow(panel, STACK_BODY))).toEqual([
        'Error: Timeout',
        STACK_FRAMES[0].trim()
      ])
    })

    it('drops the indentation an assertion library adds to a wrapped message', async () => {
      const panel = await mountErrors([
        failingCommand(
          'Timed out waiting for element\n    while polling #flash\n\n    for 5000ms'
        )
      ])

      expect(lines(shadow(panel, TITLE))).toEqual([
        'Timed out waiting for element',
        'while polling #flash',
        'for 5000ms'
      ])
    })

    it('falls back to the error name when the failure carried no message', async () => {
      const panel = await mountErrors([
        commandLog({ error: capturedError('', { name: 'AssertionError' }) })
      ])

      expect(text(shadow(panel, TITLE))).toBe('AssertionError')
    })
  })

  describe('source anchor', () => {
    it('labels the anchor with the last three segments of the call source', async () => {
      const panel = await mountErrors([loginErrors.matcher])

      expect(text(shadow(panel, LOC))).toBe(ANCHOR.matcher)
      expect(shadow(panel, LOC)?.getAttribute('title')).toBe(
        'Open source at this line'
      )
    })

    it('dispatches app-source-highlight with the full call source when clicked', async () => {
      const panel = await mountErrors([loginErrors.matcher])
      const received: string[] = []
      const listener = (event: Event) =>
        received.push((event as CustomEvent<string>).detail)

      window.addEventListener('app-source-highlight', listener)
      try {
        shadow(panel, LOC)?.dispatchEvent(new MouseEvent('click'))
      } finally {
        window.removeEventListener('app-source-highlight', listener)
      }

      expect(received).toEqual([loginErrors.matcher.callSource])
    })

    it('renders no anchor for a failure captured without a call source', async () => {
      const panel = await mountErrors([
        failingCommand('no call source', { callSource: undefined })
      ])

      expect(shadowAll(panel, LOC)).toHaveLength(0)
      expect(entries(panel)).toHaveLength(1)
    })

    it("anchors a suite-level failure at the test's own call source", async () => {
      const panel = await mountErrors(
        [],
        suiteRegistry(
          suiteFragment('login-suite', {
            tests: [
              testFragment('login-logout', {
                callSource: `${SPEC_FILE}:14:3`,
                error: testError('after hook failed')
              })
            ]
          })
        )
      )

      expect(text(shadow(panel, LOC))).toBe(ANCHOR.hook)
    })
  })

  describe('empty state', () => {
    it('renders the no-errors state when nothing failed', async () => {
      const panel = await mountErrors([])

      expect(text(shadow(panel, EMPTY_ICON))).toBe('✓')
      expect(text(shadow(panel, EMPTY_STATE))).toBe('✓ No errors')
    })

    it('renders the no-errors state before a provider supplies any data', async () => {
      const panel = await mount<DevtoolsErrors>(PANEL)

      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(1)
      expect(entries(panel)).toHaveLength(0)
    })

    it('renders no entry while the no-errors state is showing', async () => {
      const panel = await mountErrors([loginErrors.navigate], suiteRegistry())

      expect(entries(panel)).toHaveLength(0)
      expect(shadowAll(panel, EMPTY_STATE)).toHaveLength(1)
    })
  })
})
