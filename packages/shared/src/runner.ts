/**
 * HTTP contracts for the runner endpoints. Imported by the backend route
 * handlers and the app's fetch callers — keeps the body shape in lockstep
 * across the wire instead of relying on `Record<string, unknown>`.
 */

export const TESTS_API = {
  run: '/api/tests/run',
  stop: '/api/tests/stop'
} as const

/**
 * Environment variables the backend's rerun spawner sets on the child
 * process so the adapter (service/nightwatch/selenium) can detect the
 * reuse-mode handshake and connect to the existing dashboard backend
 * instead of starting a new one. Single source of truth — typos in any
 * leg of the handshake silently break reruns, so all four packages
 * (backend writer + three adapter readers) reference this object.
 */
export const REUSE_ENV = {
  REUSE: 'DEVTOOLS_APP_REUSE',
  HOST: 'DEVTOOLS_APP_HOST',
  PORT: 'DEVTOOLS_APP_PORT',
  RERUN_LABEL: 'DEVTOOLS_RERUN_LABEL',
  RERUN_ENTRY_TYPE: 'DEVTOOLS_RERUN_ENTRY_TYPE'
} as const

/**
 * Environment variables the WDIO service writes during `onPrepare` (config
 * path it detected, initial --spec args) so the backend's rerun spawner can
 * relaunch with the same config. Also covers DEVTOOLS_RUNNER_CWD which the
 * backend reads to know which directory to spawn the child in. Bin-override
 * vars (DEVTOOLS_WDIO_BIN, DEVTOOLS_NIGHTWATCH_BIN) live here too — they're
 * test-rig overrides that backend's bin-resolver respects.
 */
export const RUNNER_ENV = {
  WDIO_CONFIG: 'DEVTOOLS_WDIO_CONFIG',
  NIGHTWATCH_CONFIG: 'DEVTOOLS_NIGHTWATCH_CONFIG',
  WDIO_INITIAL_SPECS: 'DEVTOOLS_WDIO_INITIAL_SPECS',
  RUNNER_CWD: 'DEVTOOLS_RUNNER_CWD',
  WDIO_BIN: 'DEVTOOLS_WDIO_BIN',
  NIGHTWATCH_BIN: 'DEVTOOLS_NIGHTWATCH_BIN'
} as const

/** POST /api/tests/run body. */
export interface RunnerRequestBody {
  uid: string
  entryType: 'suite' | 'test'
  specFile?: string
  fullTitle?: string
  label?: string
  callSource?: string
  runAll?: boolean
  framework?: string
  configFile?: string
  lineNumber?: number
  devtoolsHost?: string
  devtoolsPort?: number
  featureFile?: string
  featureLine?: number
  suiteType?: string
  rerunCommand?: string
  launchCommand?: string
  preserveBaseline?: boolean
}

/** 200 response from /api/tests/run and /api/tests/stop. */
export interface RunnerOkResponse {
  ok: true
}

/** 4xx response shape from runner endpoints. */
export interface RunnerErrorResponse {
  error: string
}
