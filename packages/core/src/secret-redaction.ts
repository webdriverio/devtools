// The run's redactor: the `secrets` an adapter was given, plus what input masking learns as the run types into password fields.

import {
  createSecretRedactor,
  isRedactableValue,
  redactsTypedText,
  resolveSecrets,
  typedText,
  type BaseDevToolsOptions,
  type SecretRedactor
} from '@wdio/devtools-shared'
import { redactTraceArtifact } from '@wdio/devtools-trace'

import { withTimeout } from './with-timeout.js'

/** Ceiling on the one field-type read a key-sending command waits for. */
export const FIELD_TYPE_PROBE_TIMEOUT_MS = 2000

let configured: string[] = []
let typed: string[] = []
let automatic = true
let redactor: SecretRedactor | undefined
let readsInFlight = 0
let onReadsSettled: (() => void)[] = []
let generation = 0
let warn: ((message: string) => void) | undefined
let warnedUnanswered = false
/** What a field-type read that failed, hung or could not be issued resolves to. */
const UNANSWERED = Symbol('unanswered')
/** Each trace artifact written, with the redactor generation it was written under. */
const written = new Map<string, number>()

function rebuild(): void {
  redactor = createSecretRedactor(configured, {
    authHeaders: automatic,
    typed
  })
  generation++
}
rebuild()

/** Reads `secrets` at start and returns what to log, a count of skipped entries; passwords already learned stay redacted unless `maskInputs: false` turns that off. `onWarning` hears, once, that a field-type read went unanswered. */
export function configureSecretRedaction(
  options: Pick<BaseDevToolsOptions, 'secrets' | 'maskInputs'> = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
  onWarning?: (message: string) => void
): string[] {
  warn = onWarning
  warnedUnanswered = false
  const { secrets, warnings } = resolveSecrets(options.secrets, env)
  configured = secrets
  automatic = options.maskInputs !== false
  if (!automatic) {
    typed = []
  }
  rebuild()
  // A count only: a log line never carries anything read from the entries or the environment.
  return warnings.length > 0
    ? [
        `secrets: ${warnings.length} entries skipped (too short, an unset variable, or not a string or { env })`
      ]
    : []
}

/** The value with the run's secrets replaced; the value itself when nothing is redacted. */
export function redactSecrets<T>(value: T): T {
  return redactor ? redactor.redact(value) : value
}

/** Undefined when the run redacts nothing, so nothing is walked. */
export function secretRedactor(): SecretRedactor | undefined {
  return redactor
}

/** Issues the read in the caller's tick, so a hook that starts it issues it while it runs; never rejects. */
function startRead(
  readFieldType: (() => Promise<unknown>) | undefined
): Promise<unknown> {
  if (!readFieldType) {
    return Promise.resolve(UNANSWERED)
  }
  try {
    return readFieldType().catch(() => UNANSWERED)
  } catch {
    return Promise.resolve(UNANSWERED)
  }
}

function warnUnansweredOnce(): void {
  if (warnedUnanswered) {
    return
  }
  warnedUnanswered = true
  // Names no value: the warning itself must not carry what it is about.
  warn?.(
    'maskInputs: a field could not be checked for being a password before text was typed into it, so that text is redacted as a password wherever it appears. Later fields that cannot be checked are treated the same way without another warning.'
  )
}

/** Whether `noteTypedInput` would read a field type for this text: input masking is on and the value is long enough and not known yet. */
export function readsFieldType(parts: unknown): boolean {
  const text = typedText(parts)
  const known = typed.includes(text) || configured.includes(text)
  return automatic && !known && isRedactableValue(text)
}

/** Adds what a key-sending command typed to the run's secrets when `readFieldType` names a password field, or does not answer (fails, hangs, or is undefined because the field cannot be located); never rejects, and skips the read for a short or known value. */
export async function noteTypedInput(
  parts: unknown,
  readFieldType: (() => Promise<unknown>) | undefined
): Promise<void> {
  if (!readsFieldType(parts)) {
    return
  }
  const text = typedText(parts)
  readsInFlight++
  try {
    // The ceiling keeps a hung read from holding the user's command back; what it cut off counts as a password.
    const type = await withTimeout(
      startRead(readFieldType),
      FIELD_TYPE_PROBE_TIMEOUT_MS,
      UNANSWERED
    )
    const answered = type !== UNANSWERED
    if (!answered) {
      warnUnansweredOnce()
    }
    if (redactsTypedText(text, type, answered) && !typed.includes(text)) {
      typed.push(text)
      rebuild()
    }
  } finally {
    readsInFlight--
    if (readsInFlight === 0) {
      const waiters = onReadsSettled
      onReadsSettled = []
      waiters.forEach((resume) => resume())
    }
  }
}

/** Whether a field-type read is in flight, during which a frame could carry a password not yet learned. */
export function typingReadsPending(): boolean {
  return readsInFlight > 0
}

/** Resolves once no field-type read is in flight; at once when none is. */
export function whenTypingReadsSettle(): Promise<void> {
  if (readsInFlight === 0) {
    return Promise.resolve()
  }
  return new Promise((resume) => onReadsSettled.push(resume))
}

/** Records an artifact just written, so a password learned after it can still be redacted from it. */
export function noteWrittenTrace(artifactPath: string): void {
  written.set(artifactPath, generation)
}

/** Rewrites every artifact written before the redactor last grew, returning the paths that changed; one that cannot be read is reported through `onError` and skipped. */
export async function redactEarlierTraces(
  onError: (artifactPath: string, error: unknown) => void = () => {}
): Promise<string[]> {
  const current = redactor
  const changed: string[] = []
  for (const [artifactPath, writtenAt] of written) {
    if (!current || writtenAt === generation) {
      continue
    }
    try {
      if (await redactTraceArtifact(artifactPath, current)) {
        changed.push(artifactPath)
      }
      written.set(artifactPath, generation)
    } catch (error) {
      onError(artifactPath, error)
    }
  }
  return changed
}
