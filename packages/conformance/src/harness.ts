import { spawn } from 'node:child_process'

import { REUSE_ENV } from '@wdio/devtools-shared'

import {
  BROKEN_PATH,
  REPO_ROOT,
  SCENARIO_ENV,
  SCENARIO_TIMEOUT_MS
} from './constants.js'
import { judge } from './allowlist.js'
import { checkConformance } from './checker.js'
import { FakeWebDriver } from './fake-webdriver.js'
import { RecordingBackend } from './recording-backend.js'
import type { AdapterScenario, RunReport, ScenarioRun } from './types.js'

/** Runs a scenario process against the fakes, reached through the rerun reuse handshake so no adapter gains a test path. */
export async function runScenario(
  command: string,
  args: string[],
  { env = {}, bidi }: { env?: NodeJS.ProcessEnv; bidi: boolean }
): Promise<ScenarioRun> {
  const driver = await FakeWebDriver.start({ bidi })
  const backend = await RecordingBackend.start()
  try {
    const { exitCode, output } = await run(command, args, {
      ...process.env,
      ...env,
      [REUSE_ENV.REUSE]: '1',
      [REUSE_ENV.HOST]: backend.host,
      [REUSE_ENV.PORT]: String(backend.port),
      [SCENARIO_ENV.webdriver]: driver.origin,
      [SCENARIO_ENV.login]: driver.url('/login'),
      [SCENARIO_ENV.broken]: driver.url(BROKEN_PATH)
    })
    return {
      frames: [...backend.frames],
      truth: driver.truth(),
      exitCode,
      output
    }
  } finally {
    await backend.close()
    await driver.close()
  }
}

/** Runs one adapter in one mode and judges its stream; a scenario that cannot run becomes a failed report, not a thrown error. */
export async function runAdapter(
  adapter: AdapterScenario,
  bidi: boolean
): Promise<RunReport> {
  const launch = adapter.prepare()
  try {
    const run = await runScenario(launch.command, launch.args, {
      env: launch.env,
      bidi
    })
    const violations = checkConformance(run.frames, run.truth)
    return {
      adapter: adapter.id,
      bidi,
      ...run,
      violations,
      ...judge(adapter.id, bidi, violations)
    }
  } catch (err) {
    return {
      adapter: adapter.id,
      bidi,
      exitCode: null,
      output: String(err),
      frames: [],
      truth: {
        documents: [],
        failedNavigations: [],
        actions: { navigate: 0, click: 0, fill: 0 }
      },
      violations: [],
      unexplained: [],
      stale: []
    }
  } finally {
    launch.cleanup?.()
  }
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `scenario timed out after ${SCENARIO_TIMEOUT_MS} ms:\n${output}`
        )
      )
    }, SCENARIO_TIMEOUT_MS)
    child.on('error', reject)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, output })
    })
  })
}
