import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Options } from '@wdio/types'

// Layer B — visual regression. Drives the trace player served by
// serve-fixture.ts and snapshots each panel via @wdio/visual-service.
// Capabilities mirror examples/wdio/mocha/wdio.conf.ts so the player renders at
// the same viewport the goldens were captured against.
//
// Headless is the default so baselines render deterministically across machines
// and CI. Set HEADED=1 to watch the browser drive the player live — but headed
// rendering can differ from the headless goldens, so use it to observe, not to
// re-seed baselines.

const here = path.dirname(fileURLToPath(import.meta.url))
const headed = process.env.HEADED === '1' || process.env.HEADED === 'true'

export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      transpileOnly: true
    }
  },
  specs: ['./*.e2e.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          ...(headed ? [] : ['--headless']),
          '--disable-gpu',
          '--remote-allow-origins=*',
          '--window-size=1600,900'
        ]
      }
    }
  ],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  services: [
    [
      'visual',
      {
        baselineFolder: path.join(here, 'baseline'),
        // Actual + diff images for a failing run; the committed goldens live in
        // baselineFolder, so this stays out of git (see .gitignore/README).
        screenshotPath: path.join(here, '.tmp'),
        // First run has no baseline — seed it instead of failing, so a fresh
        // checkout produces the goldens to commit.
        autoSaveBaseline: true,
        formatImageName: '{tag}-{width}x{height}-dpr{dpr}'
      }
    ]
  ],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  }
}
