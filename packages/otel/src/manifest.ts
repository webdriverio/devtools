import {
  ARTIFACTS_MANIFEST_VERSION,
  isSpanId,
  isTraceId,
  type ArtifactManifestTest,
  type ArtifactsManifest,
  type TestAttemptRecord,
  type TraceArtifact
} from '@wdio/devtools-shared'

// Narrowed to what the validators below check: `scope`/`format` are not read, `path`/`kind`/`retained` are required.
export type ManifestArtifact = Omit<TraceArtifact, 'scope'>

export type ManifestAttempt = TestAttemptRecord & { error?: string }

// `state` is absent for a test the run started and never finished; such a test is pushed without a status.
export type ManifestTest = Omit<
  ArtifactManifestTest,
  'state' | 'attempt' | 'attempts'
> & {
  state?: string
  attempt: number
  attempts?: ManifestAttempt[]
}

export type Manifest = Pick<
  ArtifactsManifest,
  'manifestVersion' | 'sessionId' | 'runId' | 'parent'
> & {
  artifacts: ManifestArtifact[]
  tests: ManifestTest[]
  browserName?: string
  browserVersion?: string
  platformName?: string
}

type TestEntry = Omit<ManifestTest, 'attempt'> & { attempt?: number }

interface ManifestFile extends Omit<Manifest, 'tests'> {
  tests: unknown[]
}

const MANIFEST_KEYS = ['sessionId', 'artifacts', 'tests'] as const
const ARTIFACT_KINDS = ['trace', 'video', 'screenshot'] as const
const MAX_TRACE_FLAGS = 0xff

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArtifactKind(value: unknown): boolean {
  return ARTIFACT_KINDS.some((kind) => kind === value)
}

function isArtifact(value: unknown): value is ManifestArtifact {
  return (
    isRecord(value) &&
    isArtifactKind(value.kind) &&
    typeof value.path === 'string' &&
    (value.key === undefined || typeof value.key === 'string') &&
    Array.isArray(value.testUids) &&
    value.testUids.every(isString) &&
    typeof value.retained === 'boolean'
  )
}

function isAbsentOr(
  value: unknown,
  check: (field: unknown) => boolean
): boolean {
  return value === undefined || check(value)
}

function isNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function endsAfterStart(start: unknown, end: unknown): boolean {
  return typeof start !== 'number' || typeof end !== 'number' || end >= start
}

function isString(value: unknown): boolean {
  return typeof value === 'string'
}

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean'
}

function isAttemptNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTraceFlags(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TRACE_FLAGS
  )
}

function isAttempt(value: unknown): value is ManifestAttempt {
  return (
    isRecord(value) &&
    isAttemptNumber(value.attempt) &&
    isAbsentOr(value.state, isString) &&
    isNumber(value.startTime) &&
    isAbsentOr(value.endTime, isNumber) &&
    endsAfterStart(value.startTime, value.endTime) &&
    isTraceId(value.traceId) &&
    isSpanId(value.spanId) &&
    isAbsentOr(value.final, isBoolean) &&
    isAbsentOr(value.error, isString)
  )
}

function isParent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isTraceId(value.traceId) &&
    isSpanId(value.spanId) &&
    isTraceFlags(value.traceFlags) &&
    isAbsentOr(value.traceState, isString)
  )
}

function isTest(value: unknown): value is TestEntry {
  return (
    isRecord(value) &&
    typeof value.uid === 'string' &&
    typeof value.title === 'string' &&
    typeof value.specFile === 'string' &&
    isAbsentOr(value.state, isString) &&
    isAbsentOr(value.attempt, isAttemptNumber) &&
    isAbsentOr(value.startTime, isNumber) &&
    isAbsentOr(value.endTime, isNumber) &&
    endsAfterStart(value.startTime, value.endTime) &&
    isAbsentOr(value.durationMs, isNumber) &&
    isAbsentOr(value.error, isString) &&
    isAbsentOr(value.attempts, isAttemptList)
  )
}

// The writer stamps `final` on exactly one record whenever it writes any, so a list without one is hand-made or corrupt.
function isAttemptList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(isAttempt) &&
    (value.length === 0 ||
      value.filter((record: TestAttemptRecord) => record.final).length === 1)
  )
}

function hasManifestShape(value: unknown): value is ManifestFile {
  if (!isRecord(value) || !Array.isArray(value.tests)) {
    return false
  }
  return (
    typeof value.sessionId === 'string' &&
    isAbsentOr(value.runId, isString) &&
    isAbsentOr(value.parent, isParent) &&
    isAbsentOr(value.browserName, isString) &&
    isAbsentOr(value.browserVersion, isString) &&
    isAbsentOr(value.platformName, isString) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    value.tests.every(isTest)
  )
}

function isManifestFile(value: unknown): value is ManifestFile {
  return (
    hasManifestShape(value) &&
    value.manifestVersion === ARTIFACTS_MANIFEST_VERSION
  )
}

function describeValue(value: unknown): string {
  const shown =
    typeof value === 'string' ? JSON.stringify(value) : String(value)
  return `${shown} (${typeof value})`
}

function parentProblem(parent: Record<string, unknown>): string | undefined {
  if (!isTraceId(parent.traceId)) {
    return 'parent.traceId is not a 32-hex trace id'
  }
  if (!isSpanId(parent.spanId)) {
    return 'parent.spanId is not a 16-hex span id'
  }
  if (!isTraceFlags(parent.traceFlags)) {
    return `parent.traceFlags must be an integer 0-255, found ${describeValue(parent.traceFlags)}`
  }
  return undefined
}

function attemptsProblem(
  path: string,
  attempts: unknown[]
): string | undefined {
  for (const [index, record] of attempts.entries()) {
    if (isRecord(record) && !endsAfterStart(record.startTime, record.endTime)) {
      return `${path}.attempts[${index}].endTime is earlier than its startTime`
    }
    if (isRecord(record) && !isTraceId(record.traceId)) {
      return `${path}.attempts[${index}].traceId is not a 32-hex trace id`
    }
    if (isRecord(record) && !isSpanId(record.spanId)) {
      return `${path}.attempts[${index}].spanId is not a 16-hex span id`
    }
    if (isRecord(record) && !isAttemptNumber(record.attempt)) {
      return `${path}.attempts[${index}].attempt must be a non-negative integer, found ${describeValue(record.attempt)}`
    }
  }
  const finals = attempts.filter(
    (record) => isRecord(record) && record.final === true
  ).length
  if (attempts.length > 0 && finals === 0) {
    return `${path}.attempts has no record marked final`
  }
  return finals > 1
    ? `${path}.attempts has ${finals} records marked final`
    : undefined
}

function testProblem(entry: unknown, index: number): string | undefined {
  if (!isRecord(entry)) {
    return undefined
  }
  const path = `tests[${index}]`
  if (typeof entry.uid !== 'string') {
    return `${path} has no string uid`
  }
  if (!isAbsentOr(entry.attempt, isAttemptNumber)) {
    return `${path}.attempt must be a non-negative integer, found ${describeValue(entry.attempt)}`
  }
  if (!endsAfterStart(entry.startTime, entry.endTime)) {
    return `${path}.endTime is earlier than its startTime`
  }
  return Array.isArray(entry.attempts)
    ? attemptsProblem(path, entry.attempts)
    : undefined
}

function artifactProblem(artifacts: unknown[]): string | undefined {
  const index = artifacts.findIndex(
    (artifact) =>
      isRecord(artifact) &&
      Array.isArray(artifact.testUids) &&
      !artifact.testUids.every(isString)
  )
  return index === -1
    ? undefined
    : `artifacts[${index}].testUids must hold only strings`
}

/** The first field that names its own problem; undefined leaves the generic diagnosis. */
function specificProblem(json: Record<string, unknown>): string | undefined {
  if (
    json.parent !== undefined &&
    !isParent(json.parent) &&
    isRecord(json.parent)
  ) {
    const problem = parentProblem(json.parent)
    if (problem) {
      return problem
    }
  }
  if (Array.isArray(json.artifacts)) {
    const problem = artifactProblem(json.artifacts)
    if (problem) {
      return problem
    }
  }
  return Array.isArray(json.tests)
    ? json.tests.map(testProblem).find((problem) => problem !== undefined)
    : undefined
}

function versionProblem(found: unknown): string {
  const shown = found === undefined ? 'none' : String(found)
  return `manifest version ${shown}, this wdio-otel reads version ${ARTIFACTS_MANIFEST_VERSION}; record the run with a current devtools adapter`
}

function describeMalformedTest(tests: unknown[]): string | undefined {
  const index = tests.findIndex((entry) => !isTest(entry))
  if (index === -1) {
    return undefined
  }
  const entry = tests[index]
  const keys = isRecord(entry) ? Object.keys(entry).join(', ') : typeof entry
  return `tests[${index}] is not a test (keys: ${keys})`
}

function manifestProblem(json: unknown): string {
  if (isRecord(json) && json.manifestVersion !== ARTIFACTS_MANIFEST_VERSION) {
    return versionProblem(json.manifestVersion)
  }
  if (isRecord(json)) {
    const specific = specificProblem(json)
    if (specific) {
      return specific
    }
  }
  if (hasManifestShape(json)) {
    return versionProblem(json.manifestVersion)
  }
  const found = isRecord(json) ? Object.keys(json).join(', ') : typeof json
  const malformedTest =
    isRecord(json) && Array.isArray(json.tests)
      ? describeMalformedTest(json.tests)
      : undefined
  return `expected ${MANIFEST_KEYS.join(', ')} (artifacts and tests with their fields); found ${found}${malformedTest ? `; ${malformedTest}` : ''}`
}

/** Validates at the file boundary; throws naming the first problem it can name. */
export function parseManifest(json: unknown, source: string): Manifest {
  if (!isManifestFile(json)) {
    throw new Error(
      `${source} is not an artifacts manifest: ${manifestProblem(json)}`
    )
  }
  const tests = json.tests.filter(isTest)
  return {
    manifestVersion: json.manifestVersion,
    sessionId: json.sessionId,
    runId: json.runId,
    parent: json.parent,
    browserName: json.browserName,
    browserVersion: json.browserVersion,
    platformName: json.platformName,
    artifacts: json.artifacts,
    tests: tests.map((test) => ({ ...test, attempt: test.attempt ?? 0 }))
  }
}

// Browser and platform decide whether two finals are siblings: a failure in one browser is not retried by a pass in another.
export function browserScopeOf(manifest: Manifest): string {
  return JSON.stringify([
    manifest.browserName ?? '',
    manifest.browserVersion ?? '',
    manifest.platformName ?? ''
  ])
}
