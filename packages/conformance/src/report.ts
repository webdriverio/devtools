import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { OUT_DIR, REPORT_INDEX } from './constants.js'
import { renderReport } from './report-html.js'
import type { RunReport } from './types.js'

/** Dumps each run and rebuilds the HTML report; logs instead of throwing, so a report problem never fails a run. */
export async function writeRunReports(
  reports: RunReport[],
  outDir = OUT_DIR
): Promise<void> {
  try {
    await mkdir(outDir, { recursive: true })
    for (const report of reports) {
      const name = `${report.adapter}-${report.bidi ? 'bidi' : 'no-bidi'}.json`
      await writeAtomically(
        path.join(outDir, name),
        JSON.stringify(report, null, 2)
      )
    }
    await writeAtomically(
      path.join(outDir, REPORT_INDEX),
      renderReport(await readRunReports(outDir))
    )
  } catch (err) {
    console.error(`conformance: could not write the report to ${outDir}:`, err)
  }
}

// A reader of the dir (a browser reloading the report) never sees a half-written file.
async function writeAtomically(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, file)
}

// Each file was written by writeRunReports, so its shape is RunReport.
async function readRunReports(outDir: string): Promise<RunReport[]> {
  const files = (await readdir(outDir)).filter((f) => f.endsWith('.json'))
  return Promise.all(
    files.map(
      async (f) =>
        JSON.parse(await readFile(path.join(outDir, f), 'utf8')) as RunReport
    )
  )
}
