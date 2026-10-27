/** One expectation; `scope: 'run'` checks the whole run instead of one test's group. */
export type TestExpectation = TestScopedExpectation | RunScopedExpectation

interface ExpectationChecks {
  /** `Class.method` labels that must appear, each at least as often as listed. */
  rows?: string[]
  /** true: some row carries an error; false: none does; omitted: unchecked. */
  error?: boolean
  /** Substring an error row's message must contain. */
  errorMatches?: string
}

export interface TestScopedExpectation extends ExpectationChecks {
  scope?: 'test'
  /** The test's own title: its nearest tracing group's title, exactly or as the last segment. */
  test: string
}

export interface RunScopedExpectation extends ExpectationChecks {
  scope: 'run'
  /** Why this example cannot be checked per test; documentation only. */
  reason: string
}

export interface ExampleExpectations {
  example: string
  /** Whether the run deliberately fails, i.e. must exit non-zero. */
  runFails: boolean
  /** Lets stdout or the runner log carry a timeout; off unless a test waits on purpose. */
  allowTimeoutError?: boolean
  tests: TestExpectation[]
}

export interface TraceRow {
  callId: string
  parentId?: string
  label: string
  title: string
  error?: string
}

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
