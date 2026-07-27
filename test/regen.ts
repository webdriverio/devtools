// Regenerates the committed golden fixtures — the ONE browser-dependent step of
// the harness. Run it deliberately when you intend to change capture, then
// review the fixture diff (and `pnpm verify:update` the snapshots) and commit.
// Everyday verification runs against the committed fixtures with no browser.
//
//   pnpm fixtures:regen            # all ready entries
//   pnpm fixtures:regen wdio-mocha # one entry by id
//
// For each entry: clean its output dirs, run the example in trace mode
// (DEVTOOLS_MODE=trace), find the newest produced trace.zip, and copy it to
// test/fixtures/<id>/trace.zip.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { READY_ENTRIES, type VerificationEntry } from './capture/matrix.js'
import { findNewestZip } from './support/find-zip.js'
import { fixtureTrace, REPO_ROOT } from './support/paths.js'

function regen(entry: VerificationEntry): boolean {
  console.log(`\n── ${entry.label} [${entry.id}] ──`)

  for (const dir of entry.cleanDirs) {
    rmSync(path.resolve(REPO_ROOT, dir), { recursive: true, force: true })
  }

  const { cmd, args } = entry.command
  console.log(`  $ DEVTOOLS_MODE=trace ${cmd} ${args.join(' ')}`)
  const run = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DEVTOOLS_MODE: 'trace' },
    shell: process.platform === 'win32'
  })
  if (run.status !== 0) {
    console.warn(
      `  ⚠ command exited with ${run.status ?? run.signal} — some examples fail on purpose; still collecting.`
    )
  }

  const zip = findNewestZip(entry.traceOutputGlobs, REPO_ROOT)
  if (!zip) {
    console.error(
      `  ✗ no trace.zip found under ${entry.traceOutputGlobs.join(', ')}`
    )
    return false
  }

  const dest = fixtureTrace(entry.id)
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(zip, dest)
  console.log(
    `  ✓ ${path.relative(REPO_ROOT, zip)} → ${path.relative(REPO_ROOT, dest)}`
  )
  return true
}

const only = process.argv.slice(2)
const targets = only.length
  ? READY_ENTRIES.filter((e) => only.includes(e.id))
  : READY_ENTRIES

if (only.length && targets.length === 0) {
  console.error(`No ready entry matches: ${only.join(', ')}`)
  console.error(`Known: ${READY_ENTRIES.map((e) => e.id).join(', ')}`)
  process.exit(1)
}

const results = targets.map((entry) => ({ id: entry.id, ok: regen(entry) }))
const failed = results.filter((r) => !r.ok)

console.log(
  `\nRegenerated ${results.length - failed.length}/${results.length} fixtures.`
)
if (failed.length) {
  console.log(
    `Missing: ${failed.map((r) => r.id).join(', ')} — check the run output above (Chrome present? example wired for trace?).`
  )
  process.exit(1)
}
