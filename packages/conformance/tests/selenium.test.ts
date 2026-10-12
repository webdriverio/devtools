import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { judge } from '../src/allowlist.js'
import { checkConformance } from '../src/checker.js'
import { COLLECTOR_BUNDLE, REPO_ROOT } from '../src/constants.js'
import { runScenario } from '../src/harness.js'
import { writeRunReport } from '../src/report.js'

// The scenario runs the built adapter and injects the built collector. CI builds first, so only a local run may skip.
const ready =
  [
    path.join(REPO_ROOT, 'packages/selenium-devtools/dist/index.js'),
    COLLECTOR_BUNDLE
  ].every((f) => existsSync(f)) || Boolean(process.env.CI)

describe.each([true, false])(
  'selenium-devtools conformance (bidi: %s)',
  (bidi) => {
    it.skipIf(!ready)(
      'emits a stream that follows every rule',
      async () => {
        const run = await runScenario(
          path.join(REPO_ROOT, 'node_modules/.bin/tsx'),
          ['packages/conformance/scenarios/selenium.ts'],
          { bidi }
        )
        const violations = checkConformance(run.frames, run.truth)
        const { unexplained, stale } = judge(
          'selenium-devtools',
          bidi,
          violations
        )
        await writeRunReport({
          adapter: 'selenium-devtools',
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
