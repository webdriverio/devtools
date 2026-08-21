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
 * test-rig overrides that backend's bin-resolver respects. RUN_ID is stamped
 * before any worker forks so every worker of one run inherits it and reports
 * the same run identity (see `WORKER_WS_QUERY.runId`).
 */
export const RUNNER_ENV = {
  RUN_ID: 'DEVTOOLS_RUN_ID',
  WDIO_CONFIG: 'DEVTOOLS_WDIO_CONFIG',
  NIGHTWATCH_CONFIG: 'DEVTOOLS_NIGHTWATCH_CONFIG',
  WDIO_INITIAL_SPECS: 'DEVTOOLS_WDIO_INITIAL_SPECS',
  RUNNER_CWD: 'DEVTOOLS_RUNNER_CWD',
  WDIO_BIN: 'DEVTOOLS_WDIO_BIN',
  NIGHTWATCH_BIN: 'DEVTOOLS_NIGHTWATCH_BIN'
} as const

/**
 * Slots an adapter leaves in its `rerunCommand`, which the backend fills in
 * when the dashboard reruns one entry. The two differ in what they select by,
 * and the difference is not cosmetic:
 *
 * - `testName` is a NAME PATTERN. It is regex-escaped on substitution because
 *   every runner that consumes it filters by regex (mocha `--grep`, jest
 *   `--testNamePattern`, cucumber `--name`).
 * - `testId` is an EXACT id, substituted verbatim and shell-quoted. pytest
 *   selects by nodeid (`file.py::Class::test`), matched literally, so the
 *   escaping `testName` needs would corrupt it — measured, `pytest
 *   'test_thing\.py::test_a'` collects nothing.
 *
 * A template carries one or the other; `testId` is filled from the entry's
 * `uid`, `testName` from its label.
 */
export const RERUN_SLOT = {
  testName: '{{testName}}',
  testId: '{{testId}}'
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
