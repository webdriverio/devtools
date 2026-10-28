import type {
  ArtifactManifestTest,
  ArtifactsManifest,
  TraceArtifact
} from '@wdio/devtools-shared'

// Narrowed to what the validators below check: `scope`/`format` are not read, `state`/`attempt` are required strings/numbers.
export type ManifestArtifact = Omit<TraceArtifact, 'scope'>

export type ManifestTest = Omit<ArtifactManifestTest, 'state' | 'attempt'> & {
  state: string
  attempt: number
}

export type Manifest = Pick<ArtifactsManifest, 'sessionId'> & {
  artifacts: ManifestArtifact[]
  tests: ManifestTest[]
}

const MANIFEST_KEYS = ['sessionId', 'artifacts', 'tests'] as const
const ARTIFACT_KINDS = ['trace', 'video', 'screenshot'] as const

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
    isAbsentOr(value.error, (field) => typeof field === 'string')
  )
}

/** Cucumber step entries sit in `tests[]` beside their scenario, without a `state`. */
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

/** Retain policies other than `on` drop zips, so the telemetry for those tests is incomplete. */
export function hasRetentionFilter(manifest: Manifest): boolean {
  return manifest.artifacts.some((artifact) => !artifact.retained)
}
