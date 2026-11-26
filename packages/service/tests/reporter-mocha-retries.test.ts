import { describe, it, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import type { SuiteStats, TestStats } from '@wdio/reporter'
import { TestReporter } from '../src/reporter.js'

// Payloads follow @wdio/mocha-framework 10.2, whose fullTitle is dotted (`suite.test`).

const FILE = '/proj/login.spec.ts'
const SUITE = { uid: 'suite-0-0', title: 'login', type: 'suite', file: FILE }

function harness() {
  const report = vi.fn()
  const onRetry = vi.fn()
  const reporter = new TestReporter(
    { logFile: path.join(os.tmpdir(), 'reporter-mocha-retries.log') },
    report,
    () => {},
    onRetry
  )
  const emit = (event: string, payload: Record<string, unknown>) =>
    reporter.emit(event, { cid: '0-0', specs: [FILE], ...payload })
  emit('runner:start', { capabilities: { browserName: 'chrome' }, config: {} })
  emit('suite:start', SUITE)
  return { reporter, onRetry, emit }
}

function mochaTest(uid: string, contextId?: string) {
  return {
    type: 'test',
    uid,
    title: 'logs in',
    fullTitle: 'login.logs in',
    parent: 'login',
    file: FILE,
    ...(contextId && { contextId })
  }
}

function suiteTests(reporter: TestReporter): TestStats[] {
  return (reporter.suites[SUITE.uid] as SuiteStats).tests
}

describe('Mocha under the service reporter', () => {
  it('leaves a failed Mocha hook to the framework', () => {
    const h = harness()
    const hook = {
      uid: 'hook-0',
      title: '"after all" hook for login',
      parent: 'login',
      file: FILE,
      hookKind: 'afterAll'
    }
    h.emit('hook:start', hook)
    h.emit('hook:end', { ...hook, error: new Error('boom') })
    h.emit('suite:end', SUITE)
    expect(suiteTests(h.reporter)).toEqual([])
  })

  it('a retried Mocha test is one row, on its first uid', () => {
    const h = harness()
    const test = mochaTest('test-0-0')
    h.emit('test:start', test)
    h.emit('test:retry', { ...test, error: new Error('flaky') })
    h.emit('test:start', test)
    h.emit('test:pass', test)
    h.emit('test:end', test)
    h.emit('suite:end', SUITE)

    const retried = h.onRetry.mock.calls[0][0] as TestStats
    const tests = suiteTests(h.reporter)
    expect(tests).toHaveLength(1)
    expect(tests[0]).toMatchObject({
      uid: retried.uid,
      state: 'passed',
      retries: 1
    })
  })

  it('keeps two interleaved same-titled tests of parallel contexts on their own uids', () => {
    const h = harness()
    const a = mochaTest('test-a', 'ctx-a')
    const b = mochaTest('test-b', 'ctx-b')
    h.emit('test:start', a)
    h.emit('test:start', b)
    const [uidA, uidB] = suiteTests(h.reporter).map((t) => t.uid)
    expect(uidA).not.toBe(uidB)
    h.emit('test:retry', { ...a, error: new Error('flaky a') })
    h.emit('test:retry', { ...b, error: new Error('flaky b') })
    // B's next attempt starts first; neither may take the other's uid.
    h.emit('test:start', b)
    h.emit('test:start', a)
    for (const test of [a, b]) {
      h.emit('test:pass', test)
      h.emit('test:end', test)
      h.emit('context:end', { contextId: test.contextId })
    }
    h.emit('suite:end', SUITE)

    const rows = suiteTests(h.reporter)
    expect(rows.map((t) => [t.contextId, t.uid])).toEqual([
      ['ctx-b', uidB],
      ['ctx-a', uidA]
    ])
    expect(
      h.onRetry.mock.calls.map(([t]) => (t as TestStats).contextId)
    ).toEqual(['ctx-a', 'ctx-b'])
  })
})
