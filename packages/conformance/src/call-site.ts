import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCallSource, type CallSite } from '@wdio/devtools-shared'

import { REPO_ROOT, RULES } from './constants.js'
import type { RecordedStream, ScenarioFile, Violation } from './types.js'

const OWN_PACKAGES = path.join(REPO_ROOT, 'packages') + path.sep

/** Every row that carries a call site must name a line of the spec that ran, never DevTools' own code. */
export function checkCallSites(
  { rows }: RecordedStream,
  scenario: ScenarioFile
): Violation[] {
  return rows.flatMap((row): Violation[] => {
    if (!row.callSource) {
      return []
    }
    const site = parseCallSite(row.callSource)
    if (
      site &&
      scenario.paths.includes(site.file) &&
      site.line >= 1 &&
      site.line <= scenario.lines
    ) {
      return []
    }
    return [
      {
        rule: RULES.callSiteInScenario,
        message: `${row.command} names ${row.callSource}: ${describeMiss(site, scenario)}`,
        subject: { kind: 'row', timestamp: row.timestamp }
      }
    ]
  })
}

function describeMiss(site: CallSite | undefined, scenario: ScenarioFile) {
  if (!site) {
    return 'not a file and line'
  }
  if (scenario.paths.includes(site.file)) {
    return `the spec has ${scenario.lines} lines`
  }
  return site.file.startsWith(OWN_PACKAGES)
    ? "DevTools' own code, not the spec"
    : `a file other than the spec (${scenario.paths[0]})`
}

/** The dashboard's own reading of a call site, its file compared as a path. */
function parseCallSite(callSource: string): CallSite | undefined {
  const site = parseCallSource(callSource)
  if (!site) {
    return undefined
  }
  const { file, line } = site
  return { file: file.startsWith('file://') ? fileURLToPath(file) : file, line }
}
