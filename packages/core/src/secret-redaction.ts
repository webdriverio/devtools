// The run's redactor: the `secrets` an adapter was given, plus what input masking learns as the run types into password fields.

import {
  createSecretRedactor,
  isPasswordFieldType,
  isRedactableValue,
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
let generation = 0
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

/** Reads `secrets` at start and returns what to log, a count of skipped entries; passwords already learned stay redacted unless `maskInputs: false` turns that off. */
export function configureSecretRedaction(
  options: Pick<BaseDevToolsOptions, 'secrets' | 'maskInputs'> = {},
  env: Readonly<Record<string, string | undefined>> = process.env
): string[] {
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
function startRead(readFieldType: () => Promise<unknown>): Promise<unknown> {
  try {
    return readFieldType().catch(() => undefined)
  } catch {
    return Promise.resolve(undefined)
  }
}

/** Whether `noteTypedInput` would read a field type for this text: input masking is on and the value is long enough and not known yet. */
export function readsFieldType(parts: unknown): boolean {
  const text = typedText(parts)
  const known = typed.includes(text) || configured.includes(text)
  return automatic && !known && isRedactableValue(text)
}

/** Adds what a key-sending command typed to the run's secrets when `readFieldType` names a password field; never rejects, and skips the read for a short or known value. */
export async function noteTypedInput(
  parts: unknown,
  readFieldType: () => Promise<unknown>
): Promise<void> {
  if (!readsFieldType(parts)) {
    return
  }
  const text = typedText(parts)
  // A read that fails or hangs leaves the value as typed: it must never hold the user's command back.
  const type = await withTimeout(
    startRead(readFieldType),
    FIELD_TYPE_PROBE_TIMEOUT_MS,
    undefined
  )
  if (isPasswordFieldType(type) && !typed.includes(text)) {
    typed.push(text)
    rebuild()
  }
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
