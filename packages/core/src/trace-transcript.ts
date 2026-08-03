// Builds the trace's `transcript.md` — a Markdown step list read by humans and
// fed to an LLM. Runner-agnostic; the exporter writes whatever this returns.

import type { CommandLog } from '@wdio/devtools-shared'
import {
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS,
  type TraceAction
} from './action-mapping.js'
import { stripAnsi } from './console.js'

/** Render `text` as one numbered markdown list item, indenting every line after
 *  the first to the marker's content column (`'1. '` → 3, `'10. '` → 4 — an
 *  ordered list's continuation indent tracks the marker width, unlike a
 *  bullet's fixed two). A step interpolates captured strings that may hold
 *  newlines — a framework error routinely does (expect-webdriverio puts
 *  `Expected:` and `Received:` on their own lines) and a typed value can too —
 *  and an unindented tail leaves the list, reading as top-level prose
 *  unattributed to the step that produced it. */
function asNumberedItem(marker: string, text: string): string {
  const indent = ' '.repeat(marker.length)
  const [head, ...tail] = text.split('\n')
  return [
    `${marker}${head}`,
    // A whitespace-only line stays empty: indenting it would only add trailing
    // whitespace, and a blank line inside an indented item is still inside it.
    ...tail.map((line) => (line.trim() ? `${indent}${line}` : ''))
  ].join('\n')
}

function errorMessage(error: NonNullable<CommandLog['error']>): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
  // Runner errors carry terminal colour (node's AssertionError diff is
  // colour-coded), which is noise in a document read by a model.
  return stripAnsi(raw).trim()
}

/** Commands that map to a trace action, in invocation order. */
function capturedSteps(
  commands: CommandLog[]
): { entry: CommandLog; action: TraceAction }[] {
  // Sort by invocation time so batched commands land at their real timeline
  // positions — Nightwatch buffers native asserts and emits them at test-end,
  // so raw order clusters all asserts after the navigations. The Actions tree
  // stays correct because buildActionEvents applies the same sort; mirror it
  // here so the transcript matches execution order. Stable + a no-op for
  // already-ordered WDIO/Selenium command logs.
  const ordered = [...commands].sort(
    (a, b) => (a.startTime ?? a.timestamp) - (b.startTime ?? b.timestamp)
  )
  const captured: { entry: CommandLog; action: TraceAction }[] = []
  for (const c of ordered) {
    const action = mapCommandToAction(String(c.command))
    if (action) {
      captured.push({ entry: c, action })
    }
  }
  return captured
}

/**
 * Generate a human/LLM-readable Markdown transcript from captured commands.
 */
export function generateTranscript(
  commands: CommandLog[],
  startWallTime: number,
  title?: string
): string {
  const wallTimeISO = new Date(startWallTime).toISOString()
  const lines: string[] = [`# ${title ?? 'Session'} — ${wallTimeISO}`, '']

  capturedSteps(commands).forEach(({ entry, action }, idx) => {
    const rawArgs = entry.args as unknown[]
    const parts: string[] = [stripAnsi(formatActionTitle(action, rawArgs))]

    if (FILL_METHODS.has(action.method) && rawArgs) {
      const valueIdx = rawArgs.length >= 2 ? 1 : 0
      if (rawArgs[valueIdx] !== undefined) {
        parts.push(`value="${stripAnsi(String(rawArgs[valueIdx]))}"`)
      }
    }

    if (entry.error) {
      parts.push(`ERROR: ${errorMessage(entry.error)}`)
    }

    lines.push(asNumberedItem(`${idx + 1}. `, parts.join('  ')))
  })

  return lines.join('\n')
}
