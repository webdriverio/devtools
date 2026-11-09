import {
  isSpanId,
  isTraceId,
  type ArtifactManifestTest,
  type ArtifactsManifest,
  type TestAttemptRecord,
  type TraceArtifact
} from '@wdio/devtools-shared'

// Narrowed to what the validators below check: `scope`/`format` are not read, `state`/`attempt` are required strings/numbers.
export type ManifestArtifact = Omit<TraceArtifact, 'scope'>

export type ManifestTest = Omit<ArtifactManifestTest, 'state' | 'attempt'> & {
  state: string
  attempt: number
}

export type Manifest = Pick<
  ArtifactsManifest,
  'sessionId' | 'runId' | 'parent'
> & {
  artifacts: ManifestArtifact[]
  tests: ManifestTest[]
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

function isString(value: unknown): boolean {
  return typeof value === 'string'
}

function isAttempt(value: unknown): value is TestAttemptRecord {
  return (
    isRecord(value) &&
    Number.isInteger(value.attempt) &&
    isAbsentOr(value.state, isString) &&
    isNumber(value.startTime) &&
    isAbsentOr(value.endTime, isNumber) &&
    isTraceId(value.traceId) &&
    isSpanId(value.spanId) &&
    isAbsentOr(value.final, (field) => typeof field === 'boolean')
  )
}

function isParent(value: unknown): boolean {
  return (
    isRecord(value) &&
    isTraceId(value.traceId) &&
    isSpanId(value.spanId) &&
    typeof value.traceFlags === 'number' &&
    Number.isInteger(value.traceFlags) &&
    value.traceFlags >= 0 &&
    value.traceFlags <= MAX_TRACE_FLAGS &&
    isAbsentOr(value.traceState, isString)
  )
}

function isTest(value: unknown): value is ManifestTest {
  return (
    isRecord(value) &&
    typeof value.uid === 'string' &&
    typeof value.title === 'string' &&
    typeof value.specFile === 'string' &&
    typeof value.state === 'string' &&
    typeof value.attempt === 'number' &&
    isAbsentOr(value.startTime, isNumber) &&
    isAbsentOr(value.endTime, isNumber) &&
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

/** Manifests written before steps were filtered out list each WDIO Cucumber step in `tests[]`, without a `state`. */
function isStepEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.state === undefined &&
    typeof value.uid === 'string' &&
    typeof value.title === 'string'
  )
}

function isTestEntry(value: unknown): boolean {
  return isTest(value) || isStepEntry(value)
}

interface ManifestFile extends Omit<Manifest, 'tests'> {
  tests: unknown[]
}

function isManifestFile(value: unknown): value is ManifestFile {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    isAbsentOr(value.runId, isString) &&
    isAbsentOr(value.parent, isParent) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact) &&
    Array.isArray(value.tests) &&
    value.tests.every(isTestEntry)
  )
}

function describeMalformedTest(tests: unknown[]): string | undefined {
  const index = tests.findIndex((entry) => !isTestEntry(entry))
  if (index === -1) {
    return undefined
  }
  const entry = tests[index]
  const keys = isRecord(entry) ? Object.keys(entry).join(', ') : typeof entry
  return `tests[${index}] is neither a test nor a step (keys: ${keys})`
}

/** Validates at the file boundary; throws naming the keys the file did have. */
export function parseManifest(json: unknown, source: string): Manifest {
  if (!isManifestFile(json)) {
    const found = isRecord(json) ? Object.keys(json).join(', ') : typeof json
    const malformedTest =
      isRecord(json) && Array.isArray(json.tests)
        ? describeMalformedTest(json.tests)
        : undefined
    throw new Error(
      `${source} is not an artifacts manifest: expected ${MANIFEST_KEYS.join(', ')} (artifacts and tests with their fields); found ${found}${malformedTest ? `; ${malformedTest}` : ''}`
    )
  }
  return { ...json, tests: json.tests.filter(isTest) }
}
