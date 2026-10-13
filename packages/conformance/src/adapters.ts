import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { COLLECTOR_BUNDLE, REPO_ROOT } from './constants.js'
import type { AdapterScenario } from './types.js'

const PYTHON = process.env.CONFORMANCE_PYTHON ?? 'python3'
const PYTHON_SRC = path.join(REPO_ROOT, 'packages/selenium-devtools-py/src')
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

/** Every adapter the suite runs. Adding one is an entry here plus its scenario script. */
export const ADAPTERS: AdapterScenario[] = [
  {
    id: 'devtools-service',
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
    ready: () =>
      [
        path.join(REPO_ROOT, 'packages/selenium-devtools/dist/index.js'),
        COLLECTOR_BUNDLE
      ].every((f) => existsSync(f)),
    prepare: () => ({
      command: path.join(REPO_ROOT, 'node_modules/.bin/tsx'),
      args: [scenario('selenium.ts')]
    })
  },
  {
    id: 'nightwatch-devtools',
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
    ready: () =>
      existsSync(COLLECTOR_BUNDLE) &&
      spawnSync(PYTHON, ['-c', 'import selenium'], {
        env: { ...process.env, PYTHONPATH: PYTHON_SRC }
      }).status === 0,
    prepare: () => {
      // Run from a copy: the adapter writes its video beside the script it runs.
      const dir = mkdtempSync(path.join(tmpdir(), 'conformance-'))
      const script = path.join(dir, 'python_scenario.py')
      copyFileSync(scenario('python_scenario.py'), script)
      return {
        command: PYTHON,
        args: [script],
        env: { PYTHONPATH: PYTHON_SRC },
        cleanup: () => rmSync(dir, { recursive: true, force: true })
      }
    }
  }
]
