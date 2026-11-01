import type { RunnerHookCallbacks } from '../types.js'

export interface RunCounters {
  runStartTs: number
  started: number
  passed: number
  failed: number
  pending: number
}

export function reportRunComplete(
  counters: RunCounters,
  callbacks: RunnerHookCallbacks,
  log: { info(message: string): void }
): void {
  const durationMs = Date.now() - counters.runStartTs
  const duration = (durationMs / 1000).toFixed(2)
  log.info(
    `🧪 Test run complete: ${counters.passed} passed, ${counters.failed} failed` +
      (counters.pending ? `, ${counters.pending} pending` : '') +
      ` (${duration}s, ${counters.started} total)`
  )
  callbacks.onTestRunComplete?.({
    passed: counters.passed,
    failed: counters.failed,
    pending: counters.pending,
    durationMs
  })
}
