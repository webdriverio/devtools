/** One expectation; `scope: 'run'` checks the whole run instead of one test's group. */
export type TestExpectation = TestScopedExpectation | RunScopedExpectation

interface ExpectationChecks {
  /** `Class.method` labels that must appear, each at least as often as listed. */
  rows?: string[]
  /** true: some row carries an error; false: none does; omitted: unchecked. */
  error?: boolean
  /** Substring an error row's message must contain. */
  errorMatches?: string
  /** Substrings each of which some row's title must contain, e.g. a wait's condition. */
  titleMatches?: string[]
}

export interface TestScopedExpectation extends ExpectationChecks {
  scope?: 'test'
  /** The test's own title: its nearest tracing group's title, exactly or as the last segment. */
  test: string
  /** This test times out on purpose: the lines of its own error rows are exempt from the run's timeout check. */
  allowTimeoutError?: boolean
  /** How many times a retried test ran; the row and error checks then read only its last attempt. */
  attempts?: number
}

export interface RunScopedExpectation extends ExpectationChecks {
  scope: 'run'
  /** Why this example cannot be checked per test; documentation only. */
  reason: string
  /** Exempting a whole run's timeouts would hide every timeout; use the example-level flag deliberately instead. */
  allowTimeoutError?: never
  attempts?: never
}

export interface ExampleExpectations {
  example: string
  /** Whether the run deliberately fails, i.e. must exit non-zero. */
  runFails: boolean
  /** Lets stdout or the runner log carry any timeout; prefer a test's own `allowTimeoutError`. */
  allowTimeoutError?: boolean
  /** Files a row's call site may point into (paths ending in one of these); unset skips the check. */
  sourceFiles?: string[]
  tests: TestExpectation[]
}

export interface TraceRow {
  callId: string
  parentId?: string
  label: string
  title: string
  error?: string
  /** The row's call site file, from the `before` event's first stack frame. */
  file?: string
}

export type LocatedRow = TraceRow & { file: string }

export interface TraceGroup {
  title: string
  parentId?: string
}

/** One `.trace` stream of a zip, reduced to what the smoke check reads. */
export interface SmokeTrace {
  source: string
  rows: TraceRow[]
  groups: Map<string, TraceGroup>
  stdio: string[]
}

export interface RunOutcome {
  exitCode?: number
  log?: string
}
