// Value-based redaction of the run's `secrets` from everything an adapter sends or writes.

import { MASKED_VALUE } from './input-mask.js'
import { MIN_SECRET_LENGTH, walkRedaction } from './redaction-walk.js'
import { SPECIAL_KEY_CLASS } from './typed-secrets.js'
import type { SecretFromEnv } from './types.js'

/** What a redacted secret reads as: the page mask's placeholder, so its length never leaks. */
export const REDACTED_SECRET = MASKED_VALUE

export interface SecretRedactorOptions {
  /** Replace credential header and cookie values (`AUTH_HEADER_NAMES` under `HEADER_KEYS`, `cookies`, cookie objects). */
  authHeaders?: boolean
  /** Values typed into password fields, redacted like `secrets`. */
  typed?: readonly string[]
}

export interface ResolvedSecrets {
  secrets: string[]
  warnings: string[]
}

export interface SecretRedactor {
  readonly secrets: readonly string[]
  /** The text with every secret, and each encoded form of it, replaced. */
  redactString(text: string): string
  /** A copy of the value with every string in it redacted; the value itself when nothing changed. Keys are kept. */
  redact<T>(value: T): T
}

const SHORT_SECRET = `shorter than ${MIN_SECRET_LENGTH} characters, so it is not redacted (that would rewrite unrelated text)`

function codePointLength(text: string): number {
  return [...text].length
}

/** The run's secrets from its option entries, an `{ env }` entry read from `env`. */
export function resolveSecrets(
  entries: readonly unknown[] | undefined,
  env: Readonly<Record<string, string | undefined>>
): ResolvedSecrets {
  const secrets: string[] = []
  const warnings: string[] = []
  for (const entry of entries ?? []) {
    let value: string
    let label: string
    if (typeof entry === 'string') {
      value = entry
      label = 'a secret'
    } else if (isSecretFromEnv(entry)) {
      const read = env[entry.env]
      if (read === undefined) {
        warnings.push(
          `secrets: ${entry.env} is not set, so nothing is redacted for it`
        )
        continue
      }
      value = read
      label = `the secret in ${entry.env}`
    } else {
      warnings.push(
        'secrets: ignoring an entry that is neither a string nor { env: string }'
      )
      continue
    }
    if (codePointLength(value.trim()) < MIN_SECRET_LENGTH) {
      warnings.push(`secrets: ${label} is ${SHORT_SECRET}`)
      continue
    }
    if (!secrets.includes(value)) {
      secrets.push(value)
    }
  }
  return { secrets, warnings }
}

function isSecretFromEnv(entry: unknown): entry is SecretFromEnv {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { env?: unknown }).env === 'string' &&
    (entry as { env: string }).env !== ''
  )
}

/** Longest first, so a form that contains another is matched whole; ties in code-unit order, so the order is deterministic. */
function longestFirst(a: string, b: string): number {
  return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)
}

const FORM_SAFE = /^[A-Za-z0-9*\-._]$/

/** `application/x-www-form-urlencoded`, as a browser serializes a form field. */
function formEncode(text: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(text)) {
    const char = String.fromCharCode(byte)
    out +=
      byte === 0x20
        ? '+'
        : byte < 0x80 && FORM_SAFE.test(char)
          ? char
          : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

function uriComponent(text: string): string | undefined {
  try {
    return encodeURIComponent(text)
  } catch {
    // A lone surrogate has no UTF-8 form, so no request can carry it encoded.
    return undefined
  }
}

// Both Appium drivers' serializers escape these four in a page-source attribute and leave `'` as it is.
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Every form a secret takes in captured text: as typed, inside a JSON string, in a URL, in a form body and in an XML attribute. Longest first. */
export function secretVariants(secret: string): string[] {
  const forms = [
    secret,
    JSON.stringify(secret).slice(1, -1),
    uriComponent(secret),
    formEncode(secret),
    xmlEscape(secret)
  ].filter((form): form is string => typeof form === 'string' && form !== '')
  return [...new Set(forms)].sort(longestFirst)
}

const DATA_URI_BASE64 = /^data:[^,]{0,200};base64,/
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/
const BINARY_MIN_LENGTH = 256

/** A screenshot, frame or stored resource: a short secret occurs in base64 by chance, and rewriting one would corrupt the image. */
function isBinaryLike(text: string): boolean {
  return (
    DATA_URI_BASE64.test(text) ||
    (text.length >= BINARY_MIN_LENGTH && BASE64_BODY.test(text))
  )
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

/** A typing row keeps the special keys pressed between its parts, so a secret typed with one inside still reads as the secret. */
function withKeysBetween(secret: string): string {
  return [...secret].map(escapeRegExp).join(`${SPECIAL_KEY_CLASS}*`)
}

/** A redactor for the given secrets, or undefined when it would change nothing, so callers pay nothing. */
export function createSecretRedactor(
  secrets: readonly string[],
  options: SecretRedactorOptions = {}
): SecretRedactor | undefined {
  const typed = options.typed ?? []
  const all = [...new Set([...secrets, ...typed])]
  if (all.length === 0 && !options.authHeaders) {
    return undefined
  }
  const rules = {
    text: stringRedactor(all),
    credentials: options.authHeaders === true,
    secrets: all.length > 0
  }
  return {
    secrets: all,
    redactString: rules.text,
    redact: <T>(value: T): T => walkRedaction(value, rules) as T
  }
}

function stringRedactor(secrets: readonly string[]): (text: string) => string {
  if (secrets.length === 0) {
    return (text) => text
  }
  const variants = [...new Set(secrets.flatMap(secretVariants))].sort(
    longestFirst
  )
  const typedForms = new Set(secrets)
  const sources = variants.map((form) =>
    typedForms.has(form) ? withKeysBetween(form) : escapeRegExp(form)
  )
  // eslint-disable-next-line security/detect-non-literal-regexp -- every alternative is escaped
  const pattern = new RegExp(sources.join('|'), 'g')
  return (text) => {
    if (isBinaryLike(text)) {
      return variants.includes(text) ? REDACTED_SECRET : text
    }
    return text.replace(pattern, REDACTED_SECRET)
  }
}
