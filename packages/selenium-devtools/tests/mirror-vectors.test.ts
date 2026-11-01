// Runs packages/shared/mirror-vectors.json against the TypeScript side of every
// function the Python adapter mirrors. It lives here because this is the JS
// twin of the Python adapter and the one package that reaches shared, core and
// the wait tracking alike. The Python runner is tests/test_mirror_vectors.py.
import type * as NodeCrypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureTimingRecord, CommandLog } from '@wdio/devtools-shared'
import {
  deviceFromCapabilities,
  isNativeAppSession,
  RUNNER_ENV
} from '@wdio/devtools-shared'
import {
  applyPerformanceData,
  formatCaptureTimingSummary,
  resolveAdapterOutputDir,
  resolveRunId,
  SessionCapturerBase,
  summarizeCaptureTiming,
  type CapturedPerformancePayload,
  type CaptureTimingSummary
} from '@wdio/devtools-core'
import { rememberElementLocator } from '../src/helpers/element-locators.js'
import {
  tagElementConditions,
  trackWaits,
  waitPollOf,
  waitRowName
} from '../src/wait-tracking.js'
import type { Patchable, WaitScope } from '../src/types.js'

// selenium-webdriver ships no types; tests reach it through require as the other suites here do.
const sw = createRequire(import.meta.url)('selenium-webdriver')

const randomDraw = vi.hoisted(() => ({ value: 0, bounds: [] as number[] }))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>()
  return {
    ...actual,
    randomInt: (max: number) => {
      randomDraw.bounds.push(max)
      return randomDraw.value
    }
  }
})

const VECTORS_PATH = fileURLToPath(
  new URL('../../shared/mirror-vectors.json', import.meta.url)
)

interface Section<C> {
  cases: C[]
  [key: string]: unknown
}
type Named = { name: string }

const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8')) as {
  notCovered: Record<string, string>
  sections: Record<string, Section<Named>>
}

function section<C extends Named>(name: string): Section<C> {
  return vectors.sections[name] as Section<C>
}

const RUNNERS = [
  'assertionTarget',
  'nativeSession',
  'runId',
  'outputDir',
  'commandRowId',
  'waitPollKeys',
  'nestedWaitIdentity',
  'performancePayload',
  'waitRowNaming',
  'captureTimingSummary'
]

it('runs every section the vectors file declares', () => {
  expect(Object.keys(vectors.sections).sort()).toEqual([...RUNNERS].sort())
})

/** Groups must partition the observed values the same way: equal names exactly where values are equal. */
function expectSameGrouping<T>(observed: T[], names: string[]): void {
  expect(observed.length, 'one observed value per named call').toBe(
    names.length
  )
  for (let i = 0; i < observed.length; i++) {
    for (let j = i + 1; j < observed.length; j++) {
      expect(
        observed[i] === observed[j],
        `items ${i} and ${j} (${names[i]}, ${names[j]})`
      ).toBe(names[i] === names[j])
    }
  }
}

describe('assertionTarget', () => {
  type Step =
    | { remember: unknown; selector: string | null }
    | { rememberMany: { prefix: string; count: number; selector: string } }
    | { lookup: unknown; expect: string | null }
    | { resolve: unknown[]; expect: string | null }

  const value = (raw: unknown): unknown => {
    const repeat = (raw as { $repeat?: [string, number] } | null)?.$repeat
    return repeat ? repeat[0].repeat(repeat[1]) : raw
  }

  for (const c of section<Named & { steps: Step[] }>('assertionTarget').cases) {
    it(c.name, async () => {
      // The registry is module state; a fresh module is an empty registry.
      vi.resetModules()
      const registry = await import('@wdio/devtools-core/read-value-locators')
      for (const step of c.steps) {
        if ('remember' in step) {
          registry.rememberReadValue(
            value(step.remember),
            step.selector ?? undefined
          )
        } else if ('rememberMany' in step) {
          const { prefix, count, selector } = step.rememberMany
          for (let i = 0; i < count; i++) {
            registry.rememberReadValue(`${prefix}${i}`, selector)
          }
        } else if ('lookup' in step) {
          expect(
            registry.selectorForReadValue(value(step.lookup)) ?? null
          ).toBe(step.expect)
        } else {
          expect(
            registry.resolveAssertTargetFromArgs(step.resolve.map(value)) ??
              null
          ).toBe(step.expect)
        }
      }
    })
  }
})

describe('nativeSession', () => {
  for (const c of section<
    Named & {
      capabilities: unknown
      expect: { nativeApp: boolean; platform: string | null }
    }
  >('nativeSession').cases) {
    it(c.name, () => {
      expect({
        nativeApp: isNativeAppSession(c.capabilities),
        platform: deviceFromCapabilities(c.capabilities)?.platform ?? null
      }).toEqual(c.expect)
    })
  }
})

describe('runId', () => {
  const runId = section<
    Named & { env: string | null; expect: 'inherited' | 'generated' }
  >('runId')
  const saved = process.env[RUNNER_ENV.RUN_ID]
  afterEach(() => {
    if (saved === undefined) {
      delete process.env[RUNNER_ENV.RUN_ID]
    } else {
      process.env[RUNNER_ENV.RUN_ID] = saved
    }
  })

  it('publishes to the variable the vectors name', () => {
    expect(RUNNER_ENV.RUN_ID).toBe(runId.envVar)
  })

  for (const c of runId.cases) {
    it(c.name, () => {
      if (c.env === null) {
        delete process.env[RUNNER_ENV.RUN_ID]
      } else {
        process.env[RUNNER_ENV.RUN_ID] = c.env
      }
      const id = resolveRunId()
      if (c.expect === 'inherited') {
        expect(id).toBe(c.env)
      } else {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
        expect(process.env[RUNNER_ENV.RUN_ID]).toBe(id)
      }
    })
  }
})

describe('outputDir', () => {
  type Input = {
    userConfiguredDir?: string
    testFilePath?: string
    fallbackDir?: string
  }
  let root: string
  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-vectors-'))
    )
  })
  afterEach(() => {
    for (const dir of fs.readdirSync(root, { recursive: true })) {
      fs.chmodSync(path.join(root, String(dir)), 0o755)
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
  const at = (rel: string) =>
    path.join(root, ...rel.replace('<installed>', 'node_modules').split('/'))

  for (const c of section<
    Named & {
      dirs: string[]
      readOnly?: string[]
      input: Input
      expect: string
    }
  >('outputDir').cases) {
    it(c.name, (ctx) => {
      for (const dir of c.dirs) {
        fs.mkdirSync(at(dir), { recursive: true })
      }
      for (const dir of c.readOnly ?? []) {
        fs.chmodSync(at(dir), 0o555)
        try {
          fs.accessSync(at(dir), fs.constants.W_OK)
          ctx.skip()
        } catch {
          // Unwritable, which is what the case needs; root ignores the mode.
        }
      }
      const input = Object.fromEntries(
        Object.entries(c.input).map(([k, v]) => [k, v === '' ? '' : at(v)])
      )
      expect(resolveAdapterOutputDir(input)).toBe(at(c.expect))
    })
  }
})

describe('commandRowId', () => {
  const ids = section<Named & { draw: number; ids: number[] }>('commandRowId')
  class Capturer extends SessionCapturerBase {}

  for (const c of ids.cases) {
    it(c.name, () => {
      randomDraw.value = c.draw
      randomDraw.bounds.length = 0
      const capturer = new Capturer()
      expect(randomDraw.bounds).toEqual([ids.randomBound])
      const sent = c.ids.map(() =>
        capturer.sendCommand({ command: 'click' } as CommandLog)
      )
      expect(sent).toEqual(c.ids)
      expect(c.ids[0]).toBe(c.draw * (ids.rowsPerProcess as number))
      expect(Number.isSafeInteger(c.ids.at(-1))).toBe(true)
    })
  }
})

/** A fake `driver.wait` that evaluates its condition once per poll, synchronously. */
function fakeWaitProto(polls: () => number): Patchable {
  const proto: Patchable = {
    wait(condition: () => unknown) {
      for (let i = 0; i < polls(); i++) {
        condition()
      }
      return true
    }
  }
  trackWaits(proto, () => {})
  return proto
}

describe('waitPollKeys', () => {
  type Call = { command: string; args: unknown[]; selector: string | null }
  const poll = (call: Call) =>
    waitPollOf(call.command, call.args, call.selector ?? undefined)

  for (const c of section<
    Named & { polls?: Call[][]; expect?: string[][]; outsideWait?: Call[] }
  >('waitPollKeys').cases) {
    it(c.name, () => {
      if (c.outsideWait) {
        for (const call of c.outsideWait) {
          expect(poll(call)).toBeUndefined()
        }
        return
      }
      const polls = c.polls ?? []
      const keys: string[] = []
      const scopes = new Set<WaitScope>()
      let index = 0
      const proto = fakeWaitProto(() => polls.length)
      ;(proto.wait as (cond: () => void) => unknown)(() => {
        for (const call of polls[index++]) {
          const found = poll(call)
          keys.push(found!.pollKey)
          scopes.add(found!.waitScope)
        }
      })
      expect(scopes.size).toBe(1)
      expectSameGrouping(keys, (c.expect ?? []).flat())
    })
  }
})

describe('nestedWaitIdentity', () => {
  let observed: WaitScope[] = []
  const record = () =>
    observed.push(waitPollOf('probe', [], undefined)!.waitScope)
  // Anonymous, with different bodies: only their source tells them apart.
  const CONDITIONS: Record<string, () => unknown> = {
    A: () => record() && 'A',
    B: () => record() && 'B',
    C: () => record() && 'C'
  }

  for (const c of section<
    Named & { outerPolls: string[][]; expect: string[][] }
  >('nestedWaitIdentity').cases) {
    it(c.name, () => {
      observed = []
      let index = 0
      const outer = fakeWaitProto(() => c.outerPolls.length)
      const inner = fakeWaitProto(() => 1)
      const startInner = (id: string) =>
        (inner.wait as (cond: () => unknown) => unknown)(CONDITIONS[id])
      ;(outer.wait as (cond: () => void) => unknown)(() => {
        for (const id of c.outerPolls[index++]) {
          startInner(id)
        }
      })
      expectSameGrouping(observed, c.expect.flat())
    })
  }
})

describe('performancePayload', () => {
  /** null and absent are one state on the wire: undefined is dropped, and Python writes None. */
  const withoutNulls = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value, (_k, v: unknown) => v ?? undefined))

  for (const c of section<
    Named & {
      payload: CapturedPerformancePayload | null
      navigatedUrl: string | null
      expect: { applied: boolean; row: Record<string, unknown> }
    }
  >('performancePayload').cases) {
    it(c.name, () => {
      const row = { command: 'url' } as CommandLog
      const applied = applyPerformanceData(
        row,
        c.payload ?? undefined,
        c.navigatedUrl ?? undefined
      )
      expect({ applied, row: withoutNulls(row) }).toEqual(c.expect)
    })
  }
})

describe('waitRowNaming', () => {
  type Locator = { using: string; value: string }
  type Condition = { factory: string; locator?: Locator; negated?: boolean }
  const BY: Record<string, (value: string) => unknown> = {
    'css selector': (v) => sw.By.css(v),
    id: (v) => sw.By.id(v),
    name: (v) => sw.By.name(v),
    xpath: (v) => sw.By.xpath(v),
    'link text': (v) => sw.By.linkText(v)
  }
  const by = ({ using, value }: Locator) => BY[using](value)

  const conditionOf = ({ factory, locator }: Condition): unknown => {
    if (factory === 'elementLocated') {
      return sw.until.elementLocated(by(locator!))
    }
    if (factory === 'elementVisible') {
      // The element a find returned, with the locator the adapter recorded for it.
      const element = new sw.WebElement({}, 'el-1')
      rememberElementLocator(element, by(locator!))
      return sw.until.elementIsVisible(element)
    }
    if (factory === 'titleIs') {
      return sw.until.titleIs('Secure Area')
    }
    return () => true
  }

  tagElementConditions(sw.until as Patchable)
  for (const c of section<
    Named & {
      condition: Condition
      expect: { command: string; selector: string | null }
    }
  >('waitRowNaming').cases) {
    // selenium-webdriver has no negated wait (Python's `until_not`), so that case has nothing to run here.
    it.skipIf(c.condition.negated)(c.name, () => {
      const { command, selector } = waitRowName(conditionOf(c.condition))
      expect({ command, selector: selector ?? null }).toEqual(c.expect)
    })
  }
})

describe('captureTimingSummary', () => {
  for (const c of section<
    Named & {
      wall: number | null
      file: string | null
      records: CaptureTimingRecord[]
      expect: { summary: CaptureTimingSummary; formatted: string }
    }
  >('captureTimingSummary').cases) {
    it(c.name, () => {
      const summary = summarizeCaptureTiming(c.records, c.wall ?? undefined)
      expect({
        summary,
        formatted: formatCaptureTimingSummary(summary, c.file ?? undefined)
      }).toEqual(c.expect)
    })
  }
})
