/**
 * Which `it` the runner is executing RIGHT NOW.
 *
 * The plugin's `beforeEach` fires once per MODULE on the BDD `describe/it`
 * interface, so the lifecycle-level current test is the module's first `it` for
 * every row in the file. Nightwatch's own `setReporterCurrentTest()` — "called
 * for every test case (not for hooks)" — runs per `it` and installs
 * `browser.currentTest` as a live getter over `reporter.currentTest`, so the
 * running testcase's NAME is readable as state on every command. That name is
 * the per-`it` signal no hook or event exposes; mapping it back onto the
 * `TestStats` the suite already registered gives each `it` its own uid, and with
 * it its own group in the trace's action tree.
 */

import type { NightwatchCurrentTest, SuiteStats, TestStats } from '../types.js'

/**
 * The registered test title a runtime testcase name refers to. Nightwatch
 * reports either the bare `it` title or one prefixed with its parents, so a
 * whole-title suffix match is accepted; anything else is no match — this never
 * guesses at "the next unprocessed test" the way the lifecycle picker does.
 */
export function matchTestName(
  runtimeName: string | undefined,
  testNames: readonly string[]
): string | undefined {
  const name = typeof runtimeName === 'string' ? runtimeName.trim() : undefined
  if (!name) {
    return undefined
  }
  return testNames.find((title) => name === title || name.endsWith(` ${title}`))
}

/**
 * The suite's registered `TestStats` for the testcase Nightwatch reports as
 * running. Undefined when nothing matches: a command issued from a hook (where
 * Nightwatch leaves the previous testcase in place), a spec whose source
 * couldn't be parsed into test names, or the cucumber runner — whose client
 * carries no `currentTest` at all, which is what keeps its per-scenario
 * structure on the lifecycle path untouched.
 */
export function findRunningTest(
  suite: SuiteStats | undefined,
  currentTest: NightwatchCurrentTest | undefined
): TestStats | undefined {
  const tests = (suite?.tests ?? []).filter(
    (t): t is TestStats => typeof t !== 'string'
  )
  const title = matchTestName(
    currentTest?.name,
    tests.map((t) => t.title)
  )
  return title ? tests.find((t) => t.title === title) : undefined
}
