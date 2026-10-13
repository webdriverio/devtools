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
  {
    env = {},
    bidi,
    timeoutMs = SCENARIO_TIMEOUT_MS
  }: { env?: NodeJS.ProcessEnv; bidi: boolean; timeoutMs?: number }
): Promise<ScenarioRun> {
  const driver = await FakeWebDriver.start({ bidi })
  const backend = await RecordingBackend.start()
  try {
    const { exitCode, output } = await run(
      command,
      args,
      {
        ...process.env,
        ...env,
        [REUSE_ENV.REUSE]: '1',
        [REUSE_ENV.HOST]: backend.host,
        [REUSE_ENV.PORT]: String(backend.port),
        [SCENARIO_ENV.webdriver]: driver.origin,
        [SCENARIO_ENV.login]: driver.url('/login'),
        [SCENARIO_ENV.broken]: driver.url(BROKEN_PATH)
      },
      timeoutMs
    )
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
        actions: { navigate: [], click: [], fill: [] }
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
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.on('data', (d) => (output += d))
    // Killed, not rejected: the frames recorded before a hang are the evidence of it.
    const timer = setTimeout(() => {
      output += `\nscenario timed out after ${timeoutMs} ms`
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', reject)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, output })
    })
  })
}
