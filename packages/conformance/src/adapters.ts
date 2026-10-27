import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { COLLECTOR_BUNDLE, REPO_ROOT } from './constants.js'
import type { AdapterScenario } from './types.js'

const PYTHON = process.env.CONFORMANCE_PYTHON ?? 'python3'
const PYTHON_SRC = path.join(REPO_ROOT, 'packages/selenium-devtools-py/src')
// pytest loads the plugin through its entry point, which only an installed adapter registers; without it pytest exits 4 on `--devtools`.
const PYTEST_PLUGIN_INSTALLED = `import sys, selenium, pytest
from importlib.metadata import entry_points
sys.exit(0 if any(e.name == 'selenium_devtools' for e in entry_points(group='pytest11')) else 1)`
const scenario = (file: string) =>
  path.join(REPO_ROOT, 'packages/conformance/scenarios', file)
// This package's own bin: nightwatch is a dev dependency here, not of the root.
const WDIO_BIN = path.join(
  REPO_ROOT,
  'packages/conformance/node_modules/.bin/wdio'
)
const NIGHTWATCH_BIN = path.join(
  REPO_ROOT,
  'packages/conformance/node_modules/.bin/nightwatch'
)
const MOCHA_BIN = path.join(
  REPO_ROOT,
  'packages/conformance/node_modules/.bin/mocha'
)

/** Every adapter the suite runs, each through its framework's own runner. Adding one is an entry here plus its scenario folder. */
export const ADAPTERS: AdapterScenario[] = [
  {
    id: 'devtools-service',
    exitCode: 1,
    ready: () =>
      [
        path.join(REPO_ROOT, 'packages/service/dist/index.js'),
        path.join(REPO_ROOT, 'packages/service/dist/launcher.js'),
        WDIO_BIN,
        COLLECTOR_BUNDLE
      ].every((f) => existsSync(f)),
    // From this package: the CLI resolves its runner, framework and service from the working directory.
    prepare: () => ({
      command: WDIO_BIN,
      args: ['run', scenario('wdio/wdio.conf.js')],
      cwd: path.join(REPO_ROOT, 'packages/conformance')
    })
  },
  {
    id: 'selenium-devtools',
    // Mocha exits with its failure count.
    exitCode: 2,
    ready: () =>
      [
        path.join(REPO_ROOT, 'packages/selenium-devtools/dist/index.js'),
        MOCHA_BIN,
        COLLECTOR_BUNDLE
      ].every((f) => existsSync(f)),
    // From this package, so `--require` resolves the adapter as a user's project would.
    prepare: () => ({
      command: MOCHA_BIN,
      args: [
        '--require',
        '@wdio/selenium-devtools',
        '--timeout',
        '30000',
        scenario('selenium/scenario.spec.js')
      ],
      cwd: path.join(REPO_ROOT, 'packages/conformance')
    })
  },
  {
    id: 'nightwatch-devtools',
    // Nightwatch's CLI exits 5 for failed tests and for an error it catches; only bin/runner.js and lib/index.js use 10.
    exitCode: 5,
    ready: () =>
      [
        path.join(REPO_ROOT, 'packages/nightwatch-devtools/dist/index.js'),
        NIGHTWATCH_BIN,
        COLLECTOR_BUNDLE
      ].every((f) => existsSync(f)),
    prepare: () => ({
      command: NIGHTWATCH_BIN,
      args: ['-c', scenario('nightwatch/nightwatch.conf.cjs')]
    })
  },
  {
    id: 'selenium-devtools-py',
    exitCode: 1,
    ready: () =>
      existsSync(COLLECTOR_BUNDLE) &&
      spawnSync(PYTHON, ['-c', PYTEST_PLUGIN_INSTALLED], {
        env: { ...process.env, PYTHONPATH: PYTHON_SRC }
      }).status === 0,
    prepare: () => {
      // Run from a copy: the adapter writes its video beside the script it runs.
      const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'conformance-')))
      const spec = path.join(dir, 'test_scenario.py')
      copyFileSync(scenario('python/test_scenario.py'), spec)
      return {
        command: PYTHON,
        args: ['-m', 'pytest', '--devtools', '-p', 'no:cacheprovider', spec],
        cwd: dir,
        env: { PYTHONPATH: PYTHON_SRC },
        cleanup: () => rmSync(dir, { recursive: true, force: true })
      }
    }
  }
]
