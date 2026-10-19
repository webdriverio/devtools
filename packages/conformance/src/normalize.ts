import type { CommandLog, RunnerOptions, Metadata } from '@wdio/devtools-shared'
import { mapCommandToAction } from '@wdio/devtools-shared'

import { navigationTarget, readStream, servesRunControls } from './checker.js'
import { SCOPES } from './constants.js'
import type {
  NormalizedRun,
  NormalizedStep,
  RunControls,
  WireFrame
} from './types.js'

/** A run reduced to what a dashboard user sees: everything an adapter may legitimately vary is dropped. */
export function normalizeRun(frames: WireFrame[]): NormalizedRun {
  const { rows, anchors } = readStream(frames)
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
        outcome: row.error ? `error: ${row.error.message.trim()}` : 'ok',
        page: shown?.url ? pathOf(shown.url) : '(none)',
        at: row.timestamp
      }
    })
    .filter((s): s is NormalizedStep => s !== undefined)
  return {
    steps,
    snapshots: anchors.map((a) => pathOf(a.url ?? '')),
    runControls: runControlsOf(frames)
  }
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
function inputOf(row: CommandLog): string | undefined {
  // Every binding passes the text last: Nightwatch's setValue(selector, text) leads with the selector.
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
  const options = (metadata?.data as Metadata | undefined)?.options as
    RunnerOptions | undefined
  const advertised = Object.entries(options?.runCapabilities ?? {})
    .filter(([, on]) => on)
    .map(([name]) => name)
    .sort()
  return { advertised, served: servesRunControls(options) }
}

/** How the agreement table and a divergence show the run controls. */
export function describeRunControls({
  advertised,
  served
}: RunControls): string {
  return `${advertised.join(', ') || 'none'}; ${served ? 'served' : 'unserved'}`
}
