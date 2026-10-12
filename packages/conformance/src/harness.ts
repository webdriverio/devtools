import { spawn } from 'node:child_process'

import { REUSE_ENV } from '@wdio/devtools-shared'

import {
  BROKEN_PATH,
  REPO_ROOT,
  SCENARIO_ENV,
  SCENARIO_TIMEOUT_MS
} from './constants.js'
import { FakeWebDriver } from './fake-webdriver.js'
import { RecordingBackend } from './recording-backend.js'
import type { ScenarioRun } from './types.js'

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
