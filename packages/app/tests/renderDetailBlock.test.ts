// @vitest-environment happy-dom
//
// The three exported renderers return Lit templates, so they are exercised by
// rendering into a detached host and reading the DOM back. Every value the
// block prints is derived through the same helper the renderer calls
// (`safeJson`, `cleanErrorMessage`, `computeDetailBlockData`) over the command
// under test, so a field that stops reaching its row fails.

import { describe, it, expect } from 'vitest'
import { render, nothing } from 'lit'
import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'

import {
  renderDetailBlock,
  renderDetailStepBanner,
  renderExpectedActualAssertion,
  type DetailBlockCtx
} from '../src/components/workbench/compare/renderDetailBlock.js'
import {
  cleanErrorMessage,
  safeJson
} from '../src/components/workbench/compare/compareUtils.js'
import { computeDetailBlockData } from '../src/components/workbench/compare/stepResolution.js'

const RUN_START = 1_700_000_000_000
const RED = 'var(--vscode-charts-red,#f48771)'
const GREEN = 'var(--vscode-charts-green,#73c373)'

function cmd(overrides: Partial<CommandLog> = {}): CommandLog {
  return {
    command: 'getText',
    args: ['#flash'],
    timestamp: RUN_START,
    ...overrides
  } as CommandLog
}

function step(overrides: Partial<PreservedStep> = {}): PreservedStep {
  return {
    uid: 'login-assert',
    title: 'shows the secure-area flash',
    fullTitle: 'login page shows the secure-area flash',
    start: RUN_START - 100,
    end: RUN_START + 1000,
    state: 'passed',
    ...overrides
  } as PreservedStep
}

function renderInto(template: unknown): HTMLElement {
  const host = document.createElement('div')
  render(template as never, host)
  return host
}

/** Trimmed, whitespace-collapsed text of every `<pre>`, in render order. */
const preLines = (host: Element): string[] =>
  [...host.querySelectorAll('pre')].map((pre) =>
    (pre.textContent ?? '').replace(/\s+/g, ' ').trim()
  )

const styleOf = (host: Element, index = 0): string =>
  host.querySelectorAll('pre')[index]?.getAttribute('style') ?? ''

/** A ctx whose baseline and live sides carry different command lists, so a
 *  renderer reading the wrong one is visible. */
function ctxWith(
  overrides: {
    baselineCommands?: CommandLog[]
    liveCommands?: CommandLog[]
    step?: PreservedStep | undefined
    stepPerSide?: Partial<Record<'baseline' | 'latest', PreservedStep>>
  } = {}
): DetailBlockCtx {
  return {
    baseline: {
      commands: overrides.baselineCommands ?? []
    } as PreservedAttempt,
    liveCommandsForSelectedUid: () => overrides.liveCommands ?? [],
    findStepFor: (_c, side) =>
      overrides.stepPerSide ? overrides.stepPerSide[side] : overrides.step
  }
}

describe('renderDetailStepBanner', () => {
  it('renders nothing when the command resolved to no step', () => {
    expect(renderDetailStepBanner(undefined, 'ignored')).toBe(nothing)
    expect(
      preLines(renderInto(renderDetailStepBanner(undefined, 'x')))
    ).toEqual([])
  })

  it('names the step it was given', () => {
    const host = renderInto(renderDetailStepBanner(step(), 'login page fills'))

    expect(preLines(host)).toEqual(['step: login page fills'])
  })

  it('falls back to the step uid when the step text is empty', () => {
    const banner = step({ fullTitle: undefined, title: undefined })
    const host = renderInto(renderDetailStepBanner(banner, ''))

    expect(preLines(host)).toEqual([`step: ${banner.uid}`])
  })

  it('borders a failed step red and any other state green', () => {
    expect(
      styleOf(
        renderInto(renderDetailStepBanner(step({ state: 'failed' }), 's'))
      )
    ).toContain(`2px solid ${RED}`)
    expect(
      styleOf(
        renderInto(renderDetailStepBanner(step({ state: 'passed' }), 's'))
      )
    ).toContain(`2px solid ${GREEN}`)
    expect(
      styleOf(
        renderInto(renderDetailStepBanner(step({ state: undefined }), 's'))
      )
    ).toContain(`2px solid ${GREEN}`)
  })
})

describe('renderExpectedActualAssertion', () => {
  it('renders expected, actual and the assertion message in that order', () => {
    const host = renderInto(
      renderExpectedActualAssertion(
        'Secure Area',
        'Your username is invalid!',
        'Expect $(`#flash`) to have text',
        undefined
      )
    )

    expect(preLines(host)).toEqual([
      `expected: ${safeJson('Secure Area')}`,
      `actual: ${safeJson('Your username is invalid!')}`,
      'assertion: Expect $(`#flash`) to have text'
    ])
    expect(preLines(host)).toEqual([
      'expected: "Secure Area"',
      'actual: "Your username is invalid!"',
      'assertion: Expect $(`#flash`) to have text'
    ])
  })

  it('renders nothing at all when it was handed no values', () => {
    expect(
      preLines(
        renderInto(
          renderExpectedActualAssertion(
            undefined,
            undefined,
            undefined,
            undefined
          )
        )
      )
    ).toEqual([])
  })

  it('renders a structured expected value in preference to the step-text fallback', () => {
    const host = renderInto(
      renderExpectedActualAssertion(
        'Secure Area',
        undefined,
        undefined,
        'from step'
      )
    )

    expect(preLines(host)).toEqual(['expected: "Secure Area"'])
  })

  it('marks a step-text fallback as derived, in its own titled row', () => {
    const host = renderInto(
      renderExpectedActualAssertion(
        undefined,
        undefined,
        undefined,
        'Secure Area'
      )
    )

    expect(preLines(host)).toEqual(['expected (from step): Secure Area'])
    expect(host.querySelectorAll('pre')[0].getAttribute('title')).toContain(
      'Derived from the step text'
    )
  })

  it('renders an actual value with no expected beside it', () => {
    const host = renderInto(
      renderExpectedActualAssertion(
        undefined,
        'Login Page',
        undefined,
        undefined
      )
    )

    expect(preLines(host)).toEqual(['actual: "Login Page"'])
  })

  it('renders an assertion message with no values beside it', () => {
    const host = renderInto(
      renderExpectedActualAssertion(
        undefined,
        undefined,
        'assert.ok failed',
        undefined
      )
    )

    expect(preLines(host)).toEqual(['assertion: assert.ok failed'])
  })

  it('renders a falsy-but-present expected and actual rather than dropping them', () => {
    const host = renderInto(
      renderExpectedActualAssertion(false, '', undefined, undefined)
    )

    expect(preLines(host)).toEqual(['expected: false', 'actual: ""'])
  })

  it('serialises object values through safeJson', () => {
    const expected = { text: 'Secure Area' }
    const host = renderInto(
      renderExpectedActualAssertion(expected, undefined, undefined, undefined)
    )

    expect(preLines(host)).toEqual([`expected: ${safeJson(expected)}`])
    expect(preLines(host)).toEqual(['expected: {"text":"Secure Area"}'])
  })
})

describe('renderDetailBlock', () => {
  describe('absent command', () => {
    it('reports that the side had no command at this step', () => {
      const host = renderInto(
        renderDetailBlock('Latest', undefined, 'latest', ctxWith())
      )

      expect(host.querySelector('h4')?.textContent).toBe('Latest')
      expect(host.querySelector('em')?.textContent).toBe(
        'No command at this step'
      )
      expect(preLines(host)).toEqual([])
    })
  })

  describe('heading and args', () => {
    it('heads the block with the label and the command name', () => {
      const host = renderInto(
        renderDetailBlock('Baseline', cmd(), 'baseline', ctxWith())
      )

      expect(
        (host.querySelector('h4')?.textContent ?? '').replace(/\s+/g, ' ')
      ).toBe('Baseline · getText')
    })

    it('prints the args through safeJson', () => {
      const command = cmd({ args: ['#username', 'tomsmith'] })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)[0]).toBe(`args: ${safeJson(command.args)}`)
      expect(preLines(host)[0]).toBe('args: ["#username","tomsmith"]')
    })

    it('prints an empty args list rather than omitting the row', () => {
      const host = renderInto(
        renderDetailBlock('Baseline', cmd({ args: [] }), 'baseline', ctxWith())
      )

      expect(preLines(host)[0]).toBe('args: []')
    })

    it('renders the step banner above the args when a step resolved', () => {
      const banner = step()
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          cmd(),
          'baseline',
          ctxWith({ step: banner })
        )
      )

      expect(preLines(host)).toEqual([
        `step: ${banner.fullTitle}`,
        `args: ${safeJson(['#flash'])}`,
        'result: undefined'
      ])
    })

    it('renders no step banner when nothing resolved', () => {
      const host = renderInto(
        renderDetailBlock('Baseline', cmd(), 'baseline', ctxWith())
      )

      expect(preLines(host)[0]).toBe('args: ["#flash"]')
    })
  })

  describe('result and error', () => {
    it('prints the result through safeJson', () => {
      const command = cmd({ result: 'You logged into a secure area!' })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)[1]).toBe(`result: ${safeJson(command.result)}`)
      expect(preLines(host)[1]).toBe('result: "You logged into a secure area!"')
    })

    it("prints a command's error in place of its result, cleaned", () => {
      const raw = 'element click [31mintercepted[39m'
      const command = cmd({
        command: 'click',
        result: 'ignored',
        error: { name: 'Error', message: raw }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        `args: ${safeJson(['#flash'])}`,
        `error: ${cleanErrorMessage(raw)}`
      ])
      expect(preLines(host)[1]).toBe('error: element click intercepted')
    })

    it('stringifies an error object that carries no message', () => {
      const command = cmd({
        command: 'click',
        error: { name: 'Error', message: '' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)[1]).toBe('error: [object Object]')
    })
  })

  describe('assertion commands', () => {
    it("reads an assert command's collapsed result in preference to its args", () => {
      const command = cmd({
        command: 'assert.strictEqual',
        args: ['ignored-actual', 'ignored-expected'],
        result: {
          passed: false,
          actual: 'Login Page',
          expected: 'Secure Area'
        },
        error: { name: 'AssertionError', message: 'strictEqual failed' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      // The collapsed values replace both the error row and the positional args.
      expect(preLines(host)).toEqual([
        `args: ${safeJson(command.args)}`,
        'expected: "Secure Area"',
        'actual: "Login Page"'
      ])
    })

    it('reads the positional args of an assert command with no collapsed result', () => {
      const command = cmd({
        command: 'verify.equal',
        args: ['Login Page', 'Secure Area'],
        error: { name: 'Error', message: 'verify.equal failed' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        'args: ["Login Page","Secure Area"]',
        'expected: "Secure Area"',
        'actual: "Login Page"'
      ])
    })

    it('falls back to the error of an assert command with a single argument', () => {
      const command = cmd({
        command: 'assert.ok',
        args: [false],
        error: { name: 'Error', message: 'assert.ok failed' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        'args: [false]',
        'error: assert.ok failed'
      ])
    })

    it('falls back to the error of an assert command whose result is not an object', () => {
      const command = cmd({
        command: 'expect.toHaveText',
        args: ['Secure Area'],
        result: 'not-collapsed',
        error: { name: 'Error', message: 'toHaveText failed' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        'args: ["Secure Area"]',
        'error: toHaveText failed'
      ])
    })

    it('falls back to positional args when the result object carries neither value', () => {
      const command = cmd({
        command: 'expect.toHaveText',
        args: ['Login Page', 'Secure Area'],
        result: { passed: false }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        'args: ["Login Page","Secure Area"]',
        'expected: "Secure Area"',
        'actual: "Login Page"'
      ])
    })

    it('renders a collapsed result that carries only an actual value', () => {
      const command = cmd({
        command: 'assert.ok',
        args: [false],
        result: { passed: false, actual: 'Login Page' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual(['args: [false]', 'actual: "Login Page"'])
    })

    it('leaves a non-assertion command on the result path', () => {
      // `assertEqual` is not `assert.` — the prefix test is on the dot.
      const command = cmd({
        command: 'assertEqual',
        args: ['Login Page', 'Secure Area'],
        result: { actual: 'Login Page', expected: 'Secure Area' }
      })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctxWith())
      )

      expect(preLines(host)).toEqual([
        'args: ["Login Page","Secure Area"]',
        `result: ${safeJson(command.result)}`
      ])
    })
  })

  describe("the failed step's values", () => {
    const failed = step({
      state: 'failed',
      error: {
        message: 'Expect $(`#flash`) to have text',
        expected: 'Secure Area',
        actual: 'Your username is invalid!'
      }
    })

    it("renders the step's expected, actual and assertion on the failure site", () => {
      const command = cmd()
      const ctx = ctxWith({ baselineCommands: [command], step: failed })
      const host = renderInto(
        renderDetailBlock('Baseline', command, 'baseline', ctx)
      )
      const data = computeDetailBlockData(command, failed, [command])

      expect(data.atFailureSite).toBe(true)
      expect(preLines(host)).toEqual([
        `step: ${failed.fullTitle}`,
        `args: ${safeJson(command.args)}`,
        'result: undefined',
        `expected: ${safeJson(data.expected)}`,
        `actual: ${safeJson(data.actual)}`,
        `assertion: ${data.assertionMessage}`
      ])
      expect(preLines(host).slice(3)).toEqual([
        'expected: "Secure Area"',
        'actual: "Your username is invalid!"',
        'assertion: Expect $(`#flash`) to have text'
      ])
    })

    it('reads the values off matcherResult when the error does not carry them', () => {
      const matcherStep = step({
        state: 'failed',
        error: {
          matcherResult: {
            expected: 'Secure Area',
            actual: 'Your username is invalid!',
            message: 'expected text to match'
          }
        }
      })
      const command = cmd()
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          command,
          'baseline',
          ctxWith({ baselineCommands: [command], step: matcherStep })
        )
      )

      expect(preLines(host).slice(3)).toEqual([
        'expected: "Secure Area"',
        'actual: "Your username is invalid!"',
        'assertion: expected text to match'
      ])
    })

    it('renders no expected or actual on a command that is not the failure site', () => {
      const earlier = cmd({ command: 'click', timestamp: RUN_START })
      const last = cmd({ timestamp: RUN_START + 500 })
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          earlier,
          'baseline',
          ctxWith({ baselineCommands: [earlier, last], step: failed })
        )
      )

      expect(
        computeDetailBlockData(earlier, failed, [earlier, last]).atFailureSite
      ).toBe(false)
      expect(preLines(host)).toEqual([
        `step: ${failed.fullTitle}`,
        'args: ["#flash"]',
        'result: undefined'
      ])
    })

    it('renders no expected or actual for a step that passed', () => {
      const command = cmd({ result: 'You logged into a secure area!' })
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          command,
          'baseline',
          ctxWith({
            baselineCommands: [command],
            step: step({ state: 'passed' })
          })
        )
      )

      expect(preLines(host)).toEqual([
        'step: login page shows the secure-area flash',
        'args: ["#flash"]',
        'result: "You logged into a secure area!"'
      ])
    })

    it('derives the expected value from a Cucumber step title when none was surfaced', () => {
      const cucumberStep = step({
        title: 'Then I should see a flash message saying "Secure Area"',
        fullTitle: undefined,
        state: 'failed'
      })
      const command = cmd()
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          command,
          'baseline',
          ctxWith({ baselineCommands: [command], step: cucumberStep })
        )
      )
      const data = computeDetailBlockData(command, cucumberStep, [command])

      expect(preLines(host)).toEqual([
        `step: ${cucumberStep.title}`,
        'args: ["#flash"]',
        'result: undefined',
        `expected (from step): ${data.fallbackExpected}`
      ])
      expect(preLines(host)[3]).toBe('expected (from step): "Secure Area"')
    })
  })

  describe('side selection', () => {
    it("resolves the baseline side's failure site against the preserved commands", () => {
      const failed = step({
        state: 'failed',
        error: { message: 'to have text', expected: 'Secure Area' }
      })
      const command = cmd({ timestamp: RUN_START })
      const later = cmd({ command: 'getTitle', timestamp: RUN_START + 500 })
      // Baseline holds only `command`, so it is the last command in the step and
      // therefore the site; the live list holds a later one, which would make it
      // *not* the site. Reading the wrong list flips the assertion rows.
      const ctx = ctxWith({
        baselineCommands: [command],
        liveCommands: [command, later],
        step: failed
      })

      expect(
        preLines(
          renderInto(renderDetailBlock('Baseline', command, 'baseline', ctx))
        )
      ).toEqual([
        `step: ${failed.fullTitle}`,
        'args: ["#flash"]',
        'result: undefined',
        'expected: "Secure Area"',
        'assertion: to have text'
      ])
      expect(
        preLines(
          renderInto(renderDetailBlock('Latest', command, 'latest', ctx))
        )
      ).toEqual([
        `step: ${failed.fullTitle}`,
        'args: ["#flash"]',
        'result: undefined'
      ])
    })

    it('asks the resolver for the side it was given', () => {
      const asked: string[] = []
      const ctx: DetailBlockCtx = {
        // Only `commands` is read on this path; the rest of PreservedAttempt is
        // irrelevant to the assertion, hence the narrowing cast.
        baseline: { commands: [] } as unknown as PreservedAttempt,
        liveCommandsForSelectedUid: () => [],
        findStepFor: (_c, side) => {
          asked.push(side)
          return undefined
        }
      }

      renderInto(renderDetailBlock('Latest', cmd(), 'latest', ctx))
      renderInto(renderDetailBlock('Baseline', cmd(), 'baseline', ctx))

      expect(asked).toEqual(['latest', 'baseline'])
    })

    it('tolerates a comparison with no baseline preserved', () => {
      const ctx: DetailBlockCtx = {
        baseline: undefined,
        liveCommandsForSelectedUid: () => [],
        findStepFor: () => undefined
      }
      const host = renderInto(
        renderDetailBlock('Baseline', cmd(), 'baseline', ctx)
      )

      expect(preLines(host)).toEqual(['args: ["#flash"]', 'result: undefined'])
    })
  })

  describe('screenshot', () => {
    it('wraps a raw base64 screenshot in a png data URL', () => {
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          cmd({ screenshot: 'iVBORw0KGg' }),
          'baseline',
          ctxWith()
        )
      )

      expect(host.querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,iVBORw0KGg'
      )
    })

    it('leaves an already-encoded data URL alone', () => {
      const screenshot = 'data:image/jpeg;base64,iVBORw0KGg'
      const host = renderInto(
        renderDetailBlock(
          'Baseline',
          cmd({ screenshot }),
          'baseline',
          ctxWith()
        )
      )

      expect(host.querySelector('img')?.getAttribute('src')).toBe(screenshot)
    })

    it('renders no image for a command captured without one', () => {
      const host = renderInto(
        renderDetailBlock('Baseline', cmd(), 'baseline', ctxWith())
      )

      expect(host.querySelectorAll('img')).toHaveLength(0)
    })
  })
})
