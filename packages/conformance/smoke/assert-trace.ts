// Usage: tsx assert-trace.ts --expect <name|file.json> [--exit-code N] [--log file] <zip-or-dir>...

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  checkExample,
  readSmokeTrace,
  totalBytes
} from './trace-expectations.js'
import type { ExampleExpectations, SmokeTrace, TraceZip } from './types.js'

const EXPECTATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'expectations'
)
const TRACE_ZIP_RE = /^trace-.*\.zip$/

function findZips(target: string): string[] {
  if (!fs.statSync(target).isDirectory()) {
    return [target]
  }
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(target, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : findZips(full)
    }
    return TRACE_ZIP_RE.test(entry.name) ? [full] : []
  })
}

function loadExpectations(name: string): ExampleExpectations {
  const file = name.endsWith('.json')
    ? name
    : path.join(EXPECTATIONS_DIR, `${name}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ExampleExpectations
}

// A workflow command ends at the first newline, and an assertion message often spans several.
function escapeAnnotation(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function readZips(paths: string[]): {
  zips: TraceZip[]
  traces: SmokeTrace[]
} {
  const zips: TraceZip[] = []
  const traces = paths.flatMap((zip) => {
    const bytes = fs.readFileSync(zip)
    zips.push({ path: zip, bytes: bytes.length })
    return readSmokeTrace(zip, bytes)
  })
  return { zips, traces }
}

function printSummary(
  label: string,
  expectations: ExampleExpectations,
  zips: TraceZip[],
  traces: SmokeTrace[]
): void {
  const listed = zips.map((zip) => `${zip.path} (${zip.bytes} bytes)`)
  console.log(
    `${label} ${zips.length} trace zip(s): ${listed.join(', ') || '(none)'}`
  )
  for (const trace of traces) {
    console.log(
      `${label} ${trace.source}: ${trace.rows.length} rows, ${trace.groups.size} groups`
    )
  }
  // Printed on a pass too: the job uploads its zips only when it fails, so this line is the size record.
  console.log(
    `${label} trace zips total ${totalBytes(zips)} of a ${expectations.traceBudget.maxBytes}-byte budget`
  )
}

function main(): number {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      expect: { type: 'string' },
      'exit-code': { type: 'string' },
      log: { type: 'string' }
    }
  })
  if (!values.expect || positionals.length === 0) {
    console.error(
      'usage: assert-trace --expect <name|file.json> [--exit-code N] [--log file] <zip-or-dir>...'
    )
    return 2
  }
  const expectations = loadExpectations(values.expect)
  const { zips, traces } = readZips(
    positionals.filter((p) => fs.existsSync(p)).flatMap(findZips)
  )
  const failures = checkExample(expectations, traces, {
    exitCode:
      values['exit-code'] === undefined
        ? undefined
        : Number(values['exit-code']),
    log: values.log ? fs.readFileSync(values.log, 'utf8') : undefined,
    zips
  })
  const label = `[${expectations.example}]`
  printSummary(label, expectations, zips, traces)
  if (failures.length === 0) {
    console.log(`${label} PASS (${expectations.tests.length} expectation(s))`)
    return 0
  }
  for (const failure of failures) {
    console.error(`${label} FAIL ${failure}`)
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(
        `::error title=examples smoke ${expectations.example}::${escapeAnnotation(failure)}`
      )
    }
  }
  return 1
}

process.exitCode = main()
