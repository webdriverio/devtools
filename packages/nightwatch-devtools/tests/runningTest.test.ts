import { describe, it, expect } from 'vitest'
import { findRunningTest, matchTestName } from '../src/helpers/runningTest.js'
import { TestManager } from '../src/helpers/testManager.js'
import { pickCurrentTestName } from '../src/test-lifecycle.js'
import type { TestReporter } from '../src/reporter.js'
import type {
  NightwatchCurrentTest,
  SuiteStats,
  TestStats
} from '../src/types.js'

const TITLES = [
  'logs into the secure area with valid credentials',
  'fails on a wrong flash message',
  'flaky: fails the first attempt, then passes'
]

function makeSuite(titles: readonly string[] = TITLES): SuiteStats {
  return {
    uid: 'suite-uid',
    title: 'nightwatch-devtools smoke test',
    tests: titles.map((title, i) => ({
      uid: `test-uid-${i}`,
      title,
      fullTitle: `nightwatch-devtools smoke test ${title}`,
      state: 'pending'
    })) as TestStats[]
  } as unknown as SuiteStats
}

function currentTest(name: string | undefined): NightwatchCurrentTest {
  return { name, module: 'tests/smoke-test.js' } as NightwatchCurrentTest
}

describe('matchTestName', () => {
  it('matches a bare testcase name', () => {
    expect(matchTestName(TITLES[1], TITLES)).toBe(TITLES[1])
  })

  it('matches a name Nightwatch reported with its parents prefixed', () => {
    expect(matchTestName(`smoke test ${TITLES[2]}`, TITLES)).toBe(TITLES[2])
  })

  it('requires a whole-title suffix, not any substring ending', () => {
    // "xfails on a wrong flash message" is a different test that happens to end
    // with another one's title — matching it would tag rows onto the wrong `it`.
    expect(matchTestName(`x${TITLES[1]}`, TITLES)).toBeUndefined()
  })

  it('has no match for an unknown, empty or absent name', () => {
    expect(matchTestName('never declared', TITLES)).toBeUndefined()
    expect(matchTestName('   ', TITLES)).toBeUndefined()
    expect(matchTestName(undefined, TITLES)).toBeUndefined()
  })
})

describe('findRunningTest', () => {
  it('gives each `it` its own uid as the reported name changes', () => {
    // The whole point: the plugin's beforeEach fires once per MODULE, so without
    // this every command in the file carried the first test's uid and the
    // trace's action tree collapsed to a single test group.
    const suite = makeSuite()
    const uids = TITLES.map(
      (title) => findRunningTest(suite, currentTest(title))?.uid
    )
    expect(uids).toEqual(['test-uid-0', 'test-uid-1', 'test-uid-2'])
    expect(new Set(uids).size).toBe(3)
  })

  it('gives the same uid while the reported name stays the same', () => {
    const suite = makeSuite()
    const first = findRunningTest(suite, currentTest(TITLES[0]))
    const second = findRunningTest(suite, currentTest(TITLES[0]))
    expect(second?.uid).toBe(first?.uid)
    expect(second).toBe(first)
  })

  it('resolves nothing for the cucumber runner, which has no currentTest', () => {
    // Cucumber's client is built with no reporter, so `browser.currentTest` is
    // undefined; its rows must stay on the lifecycle (per-scenario) test.
    expect(findRunningTest(makeSuite(), undefined)).toBeUndefined()
    expect(findRunningTest(makeSuite(), currentTest(undefined))).toBeUndefined()
  })

  it('resolves nothing when the spec source yielded no test names', () => {
    expect(
      findRunningTest(makeSuite([]), currentTest(TITLES[0]))
    ).toBeUndefined()
    expect(findRunningTest(undefined, currentTest(TITLES[0]))).toBeUndefined()
  })

  it('skips the string placeholders a suite tree can carry', () => {
    const suite = makeSuite()
    ;(suite.tests as unknown[]).unshift('not-yet-reconciled')
    expect(findRunningTest(suite, currentTest(TITLES[0]))?.uid).toBe(
      'test-uid-0'
    )
  })
})

describe('TestManager.runningTest', () => {
  function managerFor(suite: SuiteStats | undefined) {
    const reporter = {
      getCurrentSuite: () => suite
    } as unknown as TestReporter
    return new TestManager(reporter)
  }

  it('reads the running testcase off the reporter’s current suite', () => {
    expect(
      managerFor(makeSuite()).runningTest(currentTest(TITLES[1]))?.uid
    ).toBe('test-uid-1')
  })

  it('resolves nothing before a suite exists', () => {
    expect(
      managerFor(undefined).runningTest(currentTest(TITLES[1]))
    ).toBeUndefined()
  })
})

describe('pickCurrentTestName', () => {
  it('prefers the reported testcase over the next unprocessed one', () => {
    expect(
      pickCurrentTestName(currentTest(TITLES[2]), [...TITLES], new Set())
    ).toBe(TITLES[2])
  })

  it('falls back to the next unprocessed test when nothing is reported', () => {
    expect(
      pickCurrentTestName(currentTest(''), [...TITLES], new Set([TITLES[0]]))
    ).toBe(TITLES[1])
  })
})
