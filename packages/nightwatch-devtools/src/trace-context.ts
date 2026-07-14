/**
 * Assembles the framework-agnostic trace-export context from plugin state.
 *
 * Extracted from `NightwatchDevToolsPlugin.#traceContext` so the assembly is
 * unit-testable and to keep `index.ts` under the file-size cap. Both the
 * per-spec boundary flush and the final trace write share this one builder.
 */

import {
  collectSuiteTestMetadata,
  resolveAdapterOutputDir,
  type RetryOutcomeView,
  type SpecRange,
  type TraceExportContext
} from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'
import type {
  DevToolsMode,
  SuiteStats,
  TraceFormat,
  TraceGranularity,
  TraceRetentionPolicy
} from './types.js'

export interface TraceContextInput {
  mode: DevToolsMode
  policy: TraceRetentionPolicy
  granularity: TraceGranularity
  format: TraceFormat
  capturer: SessionCapturer
  suites: Iterable<SuiteStats>
  outcomes?: RetryOutcomeView
  ranges: SpecRange[]
  flushed: Set<string>
  configPath: string | undefined
  testFilePath: string | undefined
  log: (level: 'info' | 'warn', msg: string) => void
}

export function buildTraceContext(
  input: TraceContextInput,
  sessionId: string
): TraceExportContext {
  return {
    mode: input.mode,
    policy: input.policy,
    granularity: input.granularity,
    format: input.format,
    capturer: input.capturer,
    actionSnapshots: input.capturer.actionSnapshots,
    sessionId,
    testMetadata: collectSuiteTestMetadata(input.suites),
    outcomes: input.outcomes,
    ranges: input.ranges,
    flushed: input.flushed,
    resolveOutputDir: () =>
      resolveAdapterOutputDir({
        testFilePath: input.testFilePath,
        configPath: input.configPath
      }),
    awaitPending: input.capturer.snapshotCaptures,
    // Nightwatch feeds real per-test attempt numbers via TestAttemptTracker
    // (B4), so retry-aware policies use per-test attempts, not the fallback.
    attemptInfoAvailable: true,
    log: input.log
  }
}
