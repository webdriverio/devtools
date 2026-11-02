import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { TraceFormatManifest } from '../../trace/tests/fixtures/trace-formats/fixture-manifest.js'
import {
  CSP_VIOLATION_PREFIX,
  REQUIRED_CSP_DIRECTIVES,
  WORKER_SCRIPT_RE
} from './constants.js'

/** The committed zips from older writers; their manifests say which action rows each one holds. */
export const TRACE_FORMAT_FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../trace/tests/fixtures/trace-formats'
)

export interface TraceToOpen {
  name: string
  zipPath: string
  /** Every action title the trace holds, sorted. */
  titles: readonly string[]
}

/** Each fixture zip beside its manifest's titles, in name order. */
export function readFormatFixtures(dir = TRACE_FORMAT_FIXTURES): TraceToOpen[] {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.zip'))
    .sort()
    .map((file) => {
      const name = file.slice(0, -'.zip'.length)
      const manifestPath = path.join(dir, `${name}.json`)
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`${file} has no manifest ${name}.json beside it`)
      }
      const manifest = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8')
      ) as TraceFormatManifest
      return {
        name,
        zipPath: path.join(dir, file),
        titles: [...manifest.commands.titles].sort()
      }
    })
}

/** The player capitalises an assertion's namespace (`Expect.toHaveText`); the trace stores it lowercase. */
export function rowLabelToTitle(label: string): string {
  return label
    .trim()
    .replace(
      /^(Assert|Expect|Verify)\./,
      (_match, prefix: string) => `${prefix.toLowerCase()}.`
    )
}

export interface TitleDiff {
  missing: string[]
  unexpected: string[]
}

/** Compares as multisets: a trace that repeats a command must render it as often. */
export function diffTitles(
  expected: readonly string[],
  rendered: readonly string[]
): TitleDiff {
  const remaining = new Map<string, number>()
  for (const title of expected) {
    remaining.set(title, (remaining.get(title) ?? 0) + 1)
  }
  const unexpected: string[] = []
  for (const title of rendered.map(rowLabelToTitle)) {
    const left = remaining.get(title) ?? 0
    if (left > 0) {
      remaining.set(title, left - 1)
    } else {
      unexpected.push(title)
    }
  }
  const missing = [...remaining].flatMap(([title, count]) =>
    Array<string>(count).fill(title)
  )
  return { missing, unexpected }
}

/** The CSP directives the response is missing; empty when it carries all of them. */
export function missingCspDirectives(header: string | null): string[] {
  const directives = (header ?? '')
    .split(';')
    .map((directive) => directive.trim().replace(/\s+/g, ' '))
  return REQUIRED_CSP_DIRECTIVES.filter(
    (required) => !directives.includes(required)
  )
}

/** The fields of a BiDi `log.entryAdded` event the check reads. */
export interface LogEntryLike {
  level: string
  text: string | null
  type?: string
}

/** A console error or an uncaught exception, worded for the failure report. */
export function failingLogEntry(entry: LogEntryLike): string | undefined {
  if (entry.level !== 'error') {
    return undefined
  }
  const text = entry.text ?? '(no message)'
  if (text.startsWith(CSP_VIOLATION_PREFIX)) {
    return `CSP violation: ${text.slice(CSP_VIOLATION_PREFIX.length).trim()}`
  }
  return `${entry.type === 'javascript' ? 'uncaught exception' : 'console error'}: ${text}`
}

/** The parse worker's script among the URLs the page requested, if it was one of them. */
export function requestedWorker(urls: Iterable<string>): string | undefined {
  for (const url of urls) {
    if (WORKER_SCRIPT_RE.test(url)) {
      return url
    }
  }
  return undefined
}
