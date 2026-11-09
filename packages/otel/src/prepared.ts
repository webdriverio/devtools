import type { Context } from '@opentelemetry/api'
import type { CommandLog, TracePlayerData } from '@wdio/devtools-shared'
import type { ManifestTest } from './manifest.js'
import type { PinnedSpanIds } from './span-ids.js'

export const STATE_PASSED = 'passed'
export const STATE_FAILED = 'failed'

export interface ActionInfo {
  command: CommandLog
  key: string
  ordinal: number
  failure: { message: string } | undefined
}

export interface Bounds {
  startMs: number
  endMs: number
}

export interface TraceEvidence {
  data: TracePlayerData
  actions: ActionInfo[]
  failure: ActionInfo | undefined
  span: Bounds
}

/** One attempt of a test. Manifests without `attempts` yield one view, the test itself. */
export interface AttemptView {
  attempt: number
  state: string | undefined
  ids: PinnedSpanIds | undefined
  timing: Bounds | undefined
  /** End minus start of a recorded attempt; absent when the record has no end. */
  durationMs: number | undefined
  final: boolean
}

export interface PreparedRoot {
  attributes: Record<string, string | number | boolean>
  bounds: Bounds
  state: string | undefined
  errorMessage: string | undefined
  ids: PinnedSpanIds | undefined
  context: Context
  final: boolean
  trace: TraceEvidence | undefined
}

export interface PreparedTest {
  test: ManifestTest
  roots: PreparedRoot[]
}

export function actionStart(command: CommandLog): number {
  return command.startTime ?? command.timestamp
}

export function normalizeSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ')
}
