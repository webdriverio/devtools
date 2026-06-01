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
