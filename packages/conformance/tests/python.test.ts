import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { judge } from '../src/allowlist.js'
import { checkConformance } from '../src/checker.js'
import { COLLECTOR_BUNDLE, REPO_ROOT } from '../src/constants.js'
import { runScenario } from '../src/harness.js'
import { writeRunReport } from '../src/report.js'

const PYTHON = process.env.CONFORMANCE_PYTHON ?? 'python3'
const ADAPTER_SRC = path.join(REPO_ROOT, 'packages/selenium-devtools-py/src')
const SCENARIO = path.join(
  REPO_ROOT,
  'packages/conformance/scenarios/python_scenario.py'
)

// Needs selenium and the built collector; CI has both, so only a local run may skip.
const ready =
  (spawnSync(PYTHON, ['-c', 'import selenium'], {
    env: { ...process.env, PYTHONPATH: ADAPTER_SRC }
  }).status === 0 &&
    existsSync(COLLECTOR_BUNDLE)) ||
  Boolean(process.env.CI)

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.each([true, false])(
  'selenium-devtools-py conformance (bidi: %s)',
  (bidi) => {
    it.skipIf(!ready)(
      'emits a stream that follows every rule',
      async () => {
        // Run from a copy: the adapter writes its video beside the script it runs.
        const dir = mkdtempSync(path.join(tmpdir(), 'conformance-'))
        scratch.push(dir)
        const script = path.join(dir, 'python_scenario.py')
        copyFileSync(SCENARIO, script)

        const run = await runScenario(PYTHON, [script], {
          env: { PYTHONPATH: ADAPTER_SRC },
          bidi
        })
        const violations = checkConformance(run.frames, run.truth)
        const { unexplained, stale } = judge(
          'selenium-devtools-py',
          bidi,
          violations
        )
        await writeRunReport({
          adapter: 'selenium-devtools-py',
          bidi,
          ...run,
          violations,
          unexplained,
          stale
        })
        expect(run.exitCode, run.output).toBe(0)
        expect(run.truth.documents.length).toBe(3)
        expect(unexplained).toEqual([])
        expect(stale, 'a known gap no longer occurs: remove it').toEqual([])
      },
      90_000
    )
  }
)
