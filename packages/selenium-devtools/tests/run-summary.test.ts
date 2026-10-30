import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportRunComplete } from '../src/runnerHooks/run-summary.js'
import type { RunnerHookCallbacks } from '../src/types.js'

function fakeLog() {
  const info = vi.fn()
  return { log: { info }, info }
}

function callbacks(
  onTestRunComplete?: RunnerHookCallbacks['onTestRunComplete']
): RunnerHookCallbacks {
  return {
    onTestStart: vi.fn(),
    onTestEnd: vi.fn(async () => {}),
    onTestRunComplete
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reportRunComplete', () => {
  it('logs the totals and hands the summary to the plugin', () => {
    vi.useFakeTimers()
    vi.setSystemTime(3500)
    const { log, info } = fakeLog()
    const onTestRunComplete = vi.fn()
    reportRunComplete(
      { runStartTs: 1000, started: 4, passed: 2, failed: 1, pending: 1 },
      callbacks(onTestRunComplete),
      log
    )
    expect(info).toHaveBeenCalledWith(
      '🧪 Test run complete: 2 passed, 1 failed, 1 pending (2.50s, 4 total)'
    )
    expect(onTestRunComplete).toHaveBeenCalledWith({
      passed: 2,
      failed: 1,
      pending: 1,
      durationMs: 2500
    })
  })

  it('omits the pending count when nothing is pending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { log, info } = fakeLog()
    reportRunComplete(
      { runStartTs: 1000, started: 1, passed: 1, failed: 0, pending: 0 },
      callbacks(),
      log
    )
    expect(info).toHaveBeenCalledWith(
      '🧪 Test run complete: 1 passed, 0 failed (0.00s, 1 total)'
    )
  })
})
