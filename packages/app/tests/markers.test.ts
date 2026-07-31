// @vitest-environment happy-dom
//
// `renderMarker` is a three-tier cascade and returns a Lit template, so it is
// exercised by rendering into a detached host and reading the DOM back:
//
//   1. row-level divergence kind  → "different command" / "args differ" / "⚠ error"
//   2. status marker              → "✗ in failed step" / "✗ failed" / "✓"
//   3. the "only here" pill       → prepended to the status on a truncated row
//
// Tier 2 runs the real `isFailureSite`, so the step/commands passed in are the
// resolver's actual inputs rather than a pre-computed verdict.

import { describe, it, expect } from 'vitest'
import { render, nothing } from 'lit'
import type { CommandLog, PreservedStep } from '@wdio/devtools-shared'

import {
  renderMarker,
  type MarkerContext
} from '../src/components/workbench/compare/markers.js'
import type { DivergenceKind } from '../src/components/workbench/compare/compareUtils.js'
import {
  findStepFor,
  isFailureSite
} from '../src/components/workbench/compare/stepResolution.js'

const RUN_START = 1_700_000_000_000

function cmd(overrides: Partial<CommandLog> = {}): CommandLog {
  return {
    command: 'click',
    args: ['#submit'],
    timestamp: RUN_START,
    ...overrides
  } as CommandLog
}

function step(overrides: Partial<PreservedStep> = {}): PreservedStep {
  return {
    uid: 'step-1',
    title: 'submits the form',
    fullTitle: 'login page submits the form',
    start: RUN_START - 100,
    end: RUN_START + 1000,
    state: 'passed',
    ...overrides
  } as PreservedStep
}

interface Marker {
  text: string
  classes: string[]
  title: string | null
}

/** Every marker `renderMarker` produced, in render order. */
function markers(opts: Partial<MarkerContext> = {}): Marker[] {
  const host = document.createElement('div')
  const ctx: MarkerContext = {
    cmd: cmd(),
    kind: 'none',
    step: undefined,
    allCmdsThisSide: [],
    oneSideEntirelyEmpty: false,
    ...opts
  }
  render(renderMarker(ctx), host)
  return [...host.querySelectorAll('span')].map((span) => ({
    text: (span.textContent ?? '').replace(/\s+/g, ' ').trim(),
    classes: [...span.classList],
    title: span.getAttribute('title')
  }))
}

const labels = (opts: Partial<MarkerContext> = {}) =>
  markers(opts).map((marker) => marker.text)

const only = (opts: Partial<MarkerContext> = {}): Marker => {
  const found = markers(opts)
  if (found.length !== 1) {
    throw new Error(`expected exactly one marker, rendered ${found.length}`)
  }
  return found[0]
}

describe('renderMarker', () => {
  describe('no command', () => {
    it('renders nothing for the dashed side of a truncated row', () => {
      expect(
        renderMarker({
          cmd: undefined,
          kind: 'missing',
          step: undefined,
          allCmdsThisSide: [],
          oneSideEntirelyEmpty: false
        })
      ).toBe(nothing)
      expect(markers({ cmd: undefined, kind: 'missing' })).toEqual([])
    })

    it('renders nothing whatever the divergence kind says', () => {
      const kinds: DivergenceKind[] = [
        'none',
        'commandName',
        'args',
        'error',
        'missing'
      ]
      for (const kind of kinds) {
        expect(markers({ cmd: undefined, kind })).toEqual([])
      }
    })
  })

  describe('row-level divergence (tier 1)', () => {
    it('labels a step that ran a different command', () => {
      const marker = only({ kind: 'commandName' })

      expect(marker.text).toBe('different command')
      expect(marker.classes).toEqual(['marker', 'command'])
      expect(marker.title).toBe(
        'Different WebDriver command — execution diverged at this step'
      )
    })

    it('labels a step whose arguments differ', () => {
      const marker = only({ kind: 'args' })

      expect(marker.text).toBe('args differ')
      expect(marker.classes).toEqual(['marker', 'command'])
      expect(marker.title).toBe(
        'Same command, different arguments (compare args in the expanded view)'
      )
    })

    it('names the WebDriver error of the side that carries one', () => {
      const marker = only({
        kind: 'error',
        cmd: cmd({
          error: { name: 'Error', message: 'element click intercepted' }
        })
      })

      expect(marker.text).toBe('⚠ error')
      expect(marker.classes).toEqual(['marker', 'error'])
      expect(marker.title).toBe('WebDriver error: element click intercepted')
    })

    it('falls through to the status marker for the side that did not error', () => {
      // The row's kind is `error` because the *other* side threw; this side has
      // no message of its own, so it shows its own status instead.
      const marker = only({ kind: 'error', cmd: cmd({ error: undefined }) })

      expect(marker.text).toBe('✓')
      expect(marker.classes).toEqual(['marker', 'ok'])
      expect(marker.title).toBe('Identical')
    })

    it('falls through when the error was captured without a message', () => {
      const marker = only({
        kind: 'error',
        cmd: cmd({ error: { name: 'Error', message: '' } })
      })

      expect(marker.text).toBe('✓')
    })

    it('takes precedence over the status marker of a failed step', () => {
      const failed = step({ state: 'failed' })
      const command = cmd()

      // The command *is* the failure site, so tier 2 alone would say
      // "✗ in failed step" — tier 1 wins.
      expect(isFailureSite(command, failed, [command])).toBe(true)
      expect(
        labels({
          kind: 'args',
          cmd: command,
          step: failed,
          allCmdsThisSide: [command]
        })
      ).toEqual(['args differ'])
    })
  })

  describe('status marker (tier 2)', () => {
    it('marks the failure site of a failed step, naming the step and its error', () => {
      const failed = step({
        state: 'failed',
        error: { message: 'Expect $(`#flash`) to have text "Secure Area"' }
      })
      const command = cmd()
      const marker = only({
        cmd: command,
        step: failed,
        allCmdsThisSide: [command]
      })

      expect(marker.text).toBe('✗ in failed step')
      expect(marker.classes).toEqual(['marker', 'error'])
      expect(marker.title).toBe(
        `Failed step: ${failed.fullTitle}\n${failed.error!.message}`
      )
    })

    it('names only the step when the failure carried no message', () => {
      const failed = step({ state: 'failed', error: undefined })
      const command = cmd()

      expect(
        only({ cmd: command, step: failed, allCmdsThisSide: [command] }).title
      ).toBe(`Failed step: ${failed.fullTitle}`)
    })

    it('falls back to the step title, then its uid, to identify the step', () => {
      const command = cmd()
      const titleOnly = step({ state: 'failed', fullTitle: undefined })
      const uidOnly = step({
        state: 'failed',
        fullTitle: undefined,
        title: undefined
      })

      expect(
        only({ cmd: command, step: titleOnly, allCmdsThisSide: [command] })
          .title
      ).toBe(`Failed step: ${titleOnly.title}`)
      expect(
        only({ cmd: command, step: uidOnly, allCmdsThisSide: [command] }).title
      ).toBe(`Failed step: ${uidOnly.uid}`)
    })

    it('ticks an earlier command of the same failed step', () => {
      const failed = step({ state: 'failed' })
      const earlier = cmd({ command: 'getUrl', timestamp: RUN_START })
      const last = cmd({ command: 'getText', timestamp: RUN_START + 500 })
      const allCmdsThisSide = [earlier, last]

      // The resolver decides which of the two is the site; the marker follows.
      expect(isFailureSite(earlier, failed, allCmdsThisSide)).toBe(false)
      expect(isFailureSite(last, failed, allCmdsThisSide)).toBe(true)
      expect(labels({ cmd: earlier, step: failed, allCmdsThisSide })).toEqual([
        '✓'
      ])
      expect(labels({ cmd: last, step: failed, allCmdsThisSide })).toEqual([
        '✗ in failed step'
      ])
    })

    it('marks one failure site when two commands share a millisecond', () => {
      // Command timestamps are wall-clock ms, so two fast commands in the same
      // step routinely land on the same one. A failed step has a single failure
      // site — the later of the two — not one per tied timestamp.
      const failed = step({ state: 'failed' })
      const earlier = cmd({ command: 'getText', timestamp: RUN_START + 500 })
      const last = cmd({ command: 'getAttribute', timestamp: RUN_START + 500 })
      const allCmdsThisSide = [earlier, last]

      expect(
        allCmdsThisSide.filter((c) => isFailureSite(c, failed, allCmdsThisSide))
      ).toEqual([last])
      expect(labels({ cmd: earlier, step: failed, allCmdsThisSide })).toEqual([
        '✓'
      ])
      expect(labels({ cmd: last, step: failed, allCmdsThisSide })).toEqual([
        '✗ in failed step'
      ])
    })

    it('marks no failure site in a failed step that recorded no window', () => {
      // Without a start/end there is nothing to resolve a site against, so no
      // command may claim it — including one whose timestamp is falsy.
      const failed = step({ state: 'failed', start: undefined, end: undefined })
      const command = cmd({ timestamp: 0 })

      expect(isFailureSite(command, failed, [command])).toBe(false)
      expect(
        labels({ cmd: command, step: failed, allCmdsThisSide: [command] })
      ).toEqual(['✓'])
    })

    it("marks a failed step's own erroring command even when a later command exists", () => {
      const failed = step({ state: 'failed' })
      const errored = cmd({
        error: { name: 'Error', message: 'element click intercepted' },
        timestamp: RUN_START
      })
      const later = cmd({ command: 'getText', timestamp: RUN_START + 500 })

      expect(
        labels({
          kind: 'none',
          cmd: errored,
          step: failed,
          allCmdsThisSide: [errored, later]
        })
      ).toEqual(['✗ in failed step'])
    })

    it('marks a command that errored as failed when no step state resolved', () => {
      // The latest side's live step state isn't tracked the way the baseline's
      // PreservedStep is — without this branch it would show a green ✓.
      const marker = only({
        cmd: cmd({
          error: { name: 'Error', message: 'element click intercepted' }
        }),
        step: undefined
      })

      expect(marker.text).toBe('✗ failed')
      expect(marker.classes).toEqual(['marker', 'error'])
      expect(marker.title).toBe('Failed: element click intercepted')
    })

    it('marks a command that errored inside a step that passed as failed', () => {
      const marker = only({
        cmd: cmd({ error: { name: 'Error', message: 'stale element' } }),
        step: step({ state: 'passed' })
      })

      expect(marker.text).toBe('✗ failed')
    })

    it('titles a passing tick with the step the command ran in', () => {
      const passed = step({ state: 'passed' })
      const marker = only({ cmd: cmd(), step: passed })

      expect(marker.text).toBe('✓')
      expect(marker.classes).toEqual(['marker', 'ok'])
      expect(marker.title).toBe(`Step passed: ${passed.fullTitle}`)
    })

    it('falls back to the title, then the uid, of a passing step', () => {
      expect(only({ step: step({ fullTitle: undefined }) }).title).toBe(
        'Step passed: submits the form'
      )
      expect(
        only({ step: step({ fullTitle: undefined, title: undefined }) }).title
      ).toBe('Step passed: step-1')
    })

    it('ticks a command whose step is still running as identical', () => {
      const marker = only({ cmd: cmd(), step: step({ state: 'running' }) })

      expect(marker.text).toBe('✓')
      expect(marker.title).toBe('Identical')
    })

    it('ticks a command that resolved to no step at all as identical', () => {
      const marker = only({ cmd: cmd(), step: undefined })

      expect(marker.text).toBe('✓')
      expect(marker.title).toBe('Identical')
    })

    it('follows the step the timestamp resolver actually returns', () => {
      // The step is resolved from the command's timestamp rather than handed in
      // pre-matched, so a command outside every window gets the neutral tick.
      const fill = step({
        uid: 'login-fill',
        fullTitle: 'login page fills the form',
        start: RUN_START,
        end: RUN_START + 1000,
        state: 'passed'
      })
      const assertStep = step({
        uid: 'login-assert',
        fullTitle: 'login page shows the flash',
        start: RUN_START + 1500,
        end: RUN_START + 2600,
        state: 'failed'
      })
      const baseline = { steps: [fill, assertStep] } as never
      const inFill = cmd({ timestamp: RUN_START + 500 })
      const inAssert = cmd({ timestamp: RUN_START + 2100 })
      const outside = cmd({ timestamp: RUN_START + 5000 })

      expect(
        only({
          cmd: inFill,
          step: findStepFor(inFill, 'baseline', baseline, []),
          allCmdsThisSide: [inFill]
        }).title
      ).toBe(`Step passed: ${fill.fullTitle}`)
      expect(
        only({
          cmd: inAssert,
          step: findStepFor(inAssert, 'baseline', baseline, []),
          allCmdsThisSide: [inAssert]
        }).text
      ).toBe('✗ in failed step')
      expect(
        only({
          cmd: outside,
          step: findStepFor(outside, 'baseline', baseline, []),
          allCmdsThisSide: [outside]
        }).title
      ).toBe('Identical')
    })
  })

  describe('"only here" pill (tier 3)', () => {
    it('prepends the pill to the status of a truncated row', () => {
      const rendered = markers({ kind: 'missing' })

      expect(rendered.map((marker) => marker.text)).toEqual(['only here', '✓'])
      expect(rendered[0].classes).toEqual(['marker', 'info'])
      expect(rendered[0].title).toBe(
        'Only present on this side — the other run ended before this step'
      )
      // The status stays last so the ✓ keeps the right-edge column.
      expect(rendered[1].classes).toEqual(['marker', 'ok'])
    })

    it('keeps the failure status of a truncated row alongside the pill', () => {
      const failed = step({ state: 'failed' })
      const command = cmd()

      expect(
        labels({
          kind: 'missing',
          cmd: command,
          step: failed,
          allCmdsThisSide: [command]
        })
      ).toEqual(['only here', '✗ in failed step'])
    })

    it('suppresses the pill when the other run produced no commands at all', () => {
      const rendered = markers({ kind: 'missing', oneSideEntirelyEmpty: true })

      expect(rendered.map((marker) => marker.text)).toEqual(['✓'])
    })

    it('renders no pill for a row both runs reached', () => {
      const kinds: DivergenceKind[] = ['none', 'commandName', 'args', 'error']
      for (const kind of kinds) {
        expect(labels({ kind })).not.toContain('only here')
      }
    })
  })
})
