/**
 * HTTP contracts for the runner endpoints. Imported by the backend route
 * handlers and the app's fetch callers — keeps the body shape in lockstep
 * across the wire instead of relying on `Record<string, unknown>`.
 */

export const TESTS_API = {
  run: '/api/tests/run',
  stop: '/api/tests/stop'
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
