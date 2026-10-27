import type { CommandLog, Metadata, TraceAction } from '@wdio/devtools-shared'
import {
  ASSERT_ACTION_CLASS,
  commandFailure,
  mapCommandToAction
} from '@wdio/devtools-shared'

import {
  advertisedRunControls,
  navigationTarget,
  readStream,
  servesRunControls
} from './checker.js'
import { SCOPES } from './constants.js'
import { reportedTests, scenarioTestOf } from './scenario-tests.js'
import type {
  NormalizedRun,
  NormalizedStep,
  RunControls,
  WireFrame
} from './types.js'

/** A run reduced to what a dashboard user sees: everything an adapter may legitimately vary is dropped. */
export function normalizeRun(frames: WireFrame[]): NormalizedRun {
  const { rows, anchors, requests } = readStream(frames)
  const tests = reportedTests(frames)
  const steps = rows
    .map((row): NormalizedStep | undefined => {
      const action = mapCommandToAction(row.command)
      if (!action) {
        return undefined
      }
      const shown = anchors.filter((a) => a.timestamp <= row.timestamp).at(-1)
      return {
        action: `${action.class}.${action.method}`,
        target: targetOf(row),
        ...(action.method === 'fill' ? { input: inputOf(row) } : {}),
        outcome: outcomeOf(row, action),
        page: shown?.url ? pathOf(shown.url) : '(none)',
        at: row.timestamp,
        test: scenarioTestOf(tests, row)
      }
    })
    .filter((s): s is NormalizedStep => s !== undefined)
  return {
    steps,
    snapshots: anchors.map((a) => pathOf(a.url ?? '')),
    runControls: runControlsOf(frames),
    // Sorted: adapters list the same loads in whatever order their sources delivered them.
    requests: requests.map((r) => pathOf(r.url)).sort()
  }
}

// The shared failure rule decides failed; an assertion or a wait is worded by its binding, so only the browser's own message is compared.
function outcomeOf(row: CommandLog, action: TraceAction): string {
  const failure = commandFailure(row, action)
  if (!failure) {
    return 'ok'
  }
  const judgedByClient =
    action.class === ASSERT_ACTION_CLASS || action.method.startsWith('waitFor')
  return judgedByClient ? 'failed' : `error: ${failure.message.trim()}`
}

// Ports differ per run, so a url compares by its path.
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function targetOf(row: CommandLog): string {
  const url = navigationTarget(row)
  return url ? pathOf(url) : (row.selector ?? '')
}

// A fill's text as the binding packaged it: bare, or the W3C `{text}` / `{value: [...]}` payload.
// Every binding passes it last, after whatever selector it leads with.
function inputOf(row: CommandLog): string | undefined {
  const arg = row.args.at(-1)
  if (typeof arg === 'string') {
    return arg
  }
  const payload = arg as { text?: unknown; value?: unknown } | undefined
  if (typeof payload?.text === 'string') {
    return payload.text
  }
  return Array.isArray(payload?.value) ? payload.value.join('') : undefined
}

function runControlsOf(frames: WireFrame[]): RunControls {
  const metadata = frames.find((f) => f.scope === SCOPES.metadata)
  const advertised = metadata
    ? advertisedRunControls(metadata.data as Metadata)
    : []
  return { advertised, served: servesRunControls(frames) }
}

/** How the agreement table and a divergence show the run controls. */
export function describeRunControls({
  advertised,
  served
}: RunControls): string {
  return `${advertised.join(', ') || 'none'}; ${served ? 'served' : 'unserved'}`
}
