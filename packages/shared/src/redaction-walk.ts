// Walks a captured value and replaces what a redactor covers, copying only the containers on the path to a change.

import { MASKED_VALUE } from './input-mask.js'

/** A secret shorter than this, after trimming, is ignored: replacing it would rewrite unrelated text across the whole trace. */
export const MIN_SECRET_LENGTH = 4

/** Header names whose values are replaced when a redactor covers credentials; compared case-insensitively. */
export const AUTH_HEADER_NAMES: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie'
]

/** Keys a captured header map is stored under: the shared `NetworkRequest`, its `response`, and the BiDi, interceptor and page sources. */
export const HEADER_KEYS: readonly string[] = [
  'headers',
  'requestHeaders',
  'responseHeaders'
]

/** Keys a W3C cookie object carries beside `name` and `value`; one of them marks an object as a cookie. */
const COOKIE_KEYS = [
  'domain',
  'path',
  'httpOnly',
  'secure',
  'sameSite',
  'expiry'
]

/** The walk's rules: `text` replaces secrets in any string, `credentials` covers header and cookie values by key. */
export interface RedactionRules {
  text: (text: string) => string
  credentials: boolean
  /** False until a value is known, so the walk does no string work and copies nothing but a credential's container. */
  secrets: boolean
}

interface Walk extends RedactionRules {
  seen: WeakMap<object, unknown>
}

/** A copy of `value` with the rules applied; `value` itself when nothing changed. */
export function walkRedaction(value: unknown, rules: RedactionRules): unknown {
  return walk(value, { ...rules, seen: new WeakMap() })
}

function walk(value: unknown, w: Walk, key?: string): unknown {
  if (typeof value === 'string') {
    return w.text(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Date ||
    value instanceof RegExp
  ) {
    return value
  }
  if (w.seen.has(value)) {
    return w.seen.get(value)
  }
  // A cycle reads back the original; captured payloads are JSON-shaped and have none.
  w.seen.set(value, value)
  const result =
    (w.secrets && Array.isArray(value) && redactKeystrokes(value, w)) ||
    redactObject(value, w, key)
  w.seen.set(value, result)
  return result
}

/** A W3C Send Keys payload spells the text one character per item; the joined text is redacted and split back, so the array takes the placeholder's length. */
function redactKeystrokes(items: unknown[], w: Walk): string[] | undefined {
  const isKeystrokes =
    items.length >= MIN_SECRET_LENGTH &&
    items.every((item) => typeof item === 'string' && [...item].length === 1)
  if (!isKeystrokes) {
    return undefined
  }
  const typed = items.join('')
  const redacted = w.text(typed)
  return redacted === typed ? undefined : [...redacted]
}

/** A credential header's value, a string or a list of them, as the placeholder. */
function redactCredential(value: unknown): unknown {
  if (typeof value === 'string') {
    return MASKED_VALUE
  }
  return Array.isArray(value) ? value.map(redactCredential) : value
}

/** `document.cookie`: each cookie's value replaced, its name kept. */
function redactCookieString(text: string): string {
  return text.replace(/(^|;\s*)([^=;]+)=[^;]*/g, `$1$2=${MASKED_VALUE}`)
}

function isCookieObject(record: Record<string, unknown>): boolean {
  return (
    typeof record.name === 'string' &&
    typeof record.value === 'string' &&
    COOKIE_KEYS.some((key) => key in record)
  )
}

/** How a string entry of a plain object is redacted, by what its key says it holds. */
function redactStringEntry(
  record: Record<string, unknown>,
  key: string,
  item: string,
  w: Walk
): string {
  if (w.credentials && key === 'cookies') {
    return w.text(redactCookieString(item))
  }
  if (w.credentials && key === 'value' && isCookieObject(record)) {
    return MASKED_VALUE
  }
  // Base64 bodies named by their key; rewriting a chance match would corrupt them.
  if (key === 'screenshot' || (key === 'data' && 'mimeType' in record)) {
    return item
  }
  return w.text(item)
}

function redactObject(value: object, w: Walk, key: string | undefined): object {
  if (Array.isArray(value)) {
    let out: unknown[] | undefined
    value.forEach((item, i) => {
      const redacted = walk(item, w)
      if (redacted !== item) {
        out ??= value.slice()
        out[i] = redacted
      }
    })
    return out ?? value
  }
  if (value instanceof Map) {
    const entries = [...value]
    const out = entries.map(([k, v]) => [k, walk(v, w)] as const)
    return out.some(([, v], i) => v !== entries[i][1]) ? new Map(out) : value
  }
  if (value instanceof Set) {
    const items = [...value]
    const out = items.map((item) => walk(item, w))
    return out.some((item, i) => item !== items[i]) ? new Set(out) : value
  }
  const proto = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === null) {
    return redactRecord(value as Record<string, unknown>, w, key, proto)
  }
  return redactInstance(value, proto, (item) => walk(item, w))
}

/** The record itself unless an entry changed; only then is a shallow copy made. */
function redactRecord(
  record: Record<string, unknown>,
  w: Walk,
  parentKey: string | undefined,
  proto: object | null
): Record<string, unknown> {
  const isHeaders = w.credentials && HEADER_KEYS.includes(parentKey ?? '')
  let out: Record<string, unknown> | undefined
  for (const key of Object.keys(record)) {
    const item = record[key]
    const redacted =
      isHeaders && AUTH_HEADER_NAMES.includes(key.toLowerCase())
        ? redactCredential(item)
        : typeof item === 'string'
          ? redactStringEntry(record, key, item, w)
          : walk(item, w, key)
    if (redacted !== item) {
      out ??= Object.assign(
        proto === null ? Object.create(null) : {},
        record
      ) as Record<string, unknown>
      out[key] = redacted
    }
  }
  return out ?? record
}

/** A class instance (an `Error` among them) keeps its prototype; its own data properties, enumerable or not, are redacted. */
function redactInstance(
  value: object,
  proto: object,
  next: (item: unknown) => unknown
): object {
  const descriptors = Object.getOwnPropertyDescriptors(value)
  let changed = false
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors]
    // V8 serves an error's `stack` from an own accessor that reads an internal slot a copy lacks.
    const current =
      'value' in descriptor
        ? descriptor.value
        : value instanceof Error && descriptor.get
          ? Reflect.get(value, key)
          : undefined
    if ('value' in descriptor || value instanceof Error) {
      const redacted = next(current)
      changed ||= redacted !== current
      descriptors[key as keyof typeof descriptors] = {
        value: redacted,
        writable: true,
        enumerable: descriptor.enumerable,
        configurable: true
      }
    }
  }
  return changed ? Object.create(proto, descriptors) : value
}
