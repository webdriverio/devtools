// Masks typed text in the adapter process: input command arguments where captured, then scrubs those values wherever they resurface.

import {
  DEFAULT_CAPTURE_MASK,
  MASKED_VALUE,
  resolveCaptureMask,
  SCRUB_MIN_LENGTH,
  typedValuePattern,
  type CaptureMaskConfig,
  type CaptureMaskOptions,
  type CommandLog,
  type NetworkRequest
} from '@wdio/devtools-shared'

/** Which command vocabulary an adapter reports: three client libraries, and the W3C wire names Python reports. */
export type TypedCommandVocabulary =
  'webdriverio' | 'selenium-webdriver' | 'nightwatch' | 'webdriver'

/** Where a command carries its typed text: every argument, the last one that is not a callback, or a W3C payload. */
type TypedArgs = 'all' | 'last' | 'params' | 'actions'

const TYPED_COMMANDS: Record<
  TypedCommandVocabulary,
  Readonly<Record<string, TypedArgs>>
> = {
  webdriverio: {
    setValue: 'all',
    addValue: 'all',
    keys: 'all',
    elementSendKeys: 'last',
    sendAlertText: 'all',
    performActions: 'actions'
  },
  'selenium-webdriver': { sendKeys: 'all' },
  // Nightwatch takes `([using], selector, value, [callback])`, so the value is the last argument that is data.
  nightwatch: {
    setValue: 'last',
    sendKeys: 'last',
    updateValue: 'last',
    setPassword: 'last',
    keys: 'all',
    elementIdValue: 'last',
    setAlertText: 'last'
  },
  // Only the mirror vectors use this one in TypeScript: it is the W3C wire vocabulary Python's input_masking.py masks.
  webdriver: {
    sendKeysToElement: 'params',
    setAlertValue: 'params',
    w3cActions: 'actions'
  }
}

/** Key names `keys()` accepts that say which key was pressed, not what was typed. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Return',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Command',
  'Clear',
  'Cancel',
  'Help',
  'Pause'
])

/** WebDriver's special keys live in the Private Use Area; they say which key was pressed, so they stay. */
const SPECIAL_KEY = /[\uE000-\uF8FF]/gu
const SPECIAL_KEY_ONLY = /^[\uE000-\uF8FF]+$/u
const TYPED_RUN = /[^\uE000-\uF8FF]+/gu

/** Typed values the run has seen, newest last; bounded so a data-driven suite cannot grow it without end. */
const TYPED_VALUES_MAX = 200
/** A single character carries nothing to scrub elsewhere, and remembering one would mask every equal string. */
const TYPED_VALUE_MIN = 2
/** Each value with the sequence number of when it was last typed, so a boundary can forget only what came before it. */
const typedValues = new Map<string, number>()
let typedSeq = 0
let pattern: RegExp | null | undefined
let mask: CaptureMaskConfig = DEFAULT_CAPTURE_MASK

/** Set the run's policy from an adapter's options; what was typed is forgotten only when the policy changes. */
export function configureInputMasking(
  options: CaptureMaskOptions = {}
): CaptureMaskConfig {
  const next = resolveCaptureMask(options)
  if (JSON.stringify(next) !== JSON.stringify(mask)) {
    mask = next
    clearTypedValues()
  }
  return mask
}

export function captureMask(): CaptureMaskConfig {
  return mask
}

/** Forget what was typed, at a test's start, so one test's values do not mask the next one's output. */
export function clearTypedValues(): void {
  typedValues.clear()
  pattern = undefined
}

/** A point in the typing history to forget up to later, once work still scrubbing the earlier values has settled. */
export function typedValuesMark(): number {
  return typedSeq
}

/** Forget what was typed up to `mark`, keeping anything typed since (again). */
export function forgetTypedValuesBefore(mark: number): void {
  for (const [value, seq] of typedValues) {
    if (seq <= mark) {
      typedValues.delete(value)
    }
  }
  pattern = undefined
}

function rememberTyped(text: string): void {
  const typed = text.replace(SPECIAL_KEY, '')
  if (typed.length < TYPED_VALUE_MIN) {
    return
  }
  typedValues.delete(typed)
  typedValues.set(typed, ++typedSeq)
  if (typedValues.size > TYPED_VALUES_MAX) {
    typedValues.delete(typedValues.keys().next().value!)
  }
  pattern = undefined
}

/** Each run of typed characters becomes one `MASKED_VALUE`, so neither its length nor its content survives. */
function maskTypedString(
  value: string,
  namedKeys: boolean,
  remember = true
): string {
  if (value === '' || (namedKeys && NAMED_KEYS.has(value))) {
    return value
  }
  if (remember) {
    rememberTyped(value)
  }
  return value.replace(TYPED_RUN, MASKED_VALUE)
}

/** An array types its strings one after another, so their join is what was typed, never each element alone. */
function maskTyped(
  value: unknown,
  namedKeys: boolean,
  remember = true
): unknown {
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (remember) {
      rememberTyped(String(value))
    }
    return MASKED_VALUE
  }
  if (typeof value === 'string') {
    return maskTypedString(value, namedKeys, remember)
  }
  if (Array.isArray(value)) {
    if (remember) {
      rememberTyped(
        value
          .filter(
            (v) => typeof v === 'string' && !(namedKeys && NAMED_KEYS.has(v))
          )
          .join('')
      )
    }
    return value.map((v) => maskTyped(v, namedKeys, false))
  }
  return value
}

interface KeyAction {
  type?: unknown
  value?: unknown
}

/** A key action that types a character, rather than pressing a special key or pausing. */
function isTypedKey(
  action: KeyAction
): action is { type: string; value: string } {
  return (
    (action.type === 'keyDown' || action.type === 'keyUp') &&
    typeof action.value === 'string' &&
    action.value !== '' &&
    !SPECIAL_KEY_ONLY.test(action.value)
  )
}

/** Shift (left, right) only changes what the keys type, so it belongs to the run it is held through. */
const SHIFT_KEYS: ReadonlySet<string> = new Set(['\uE008', '\uE050'])

function isShift(action: KeyAction): boolean {
  return (
    (action.type === 'keyDown' || action.type === 'keyUp') &&
    typeof action.value === 'string' &&
    SHIFT_KEYS.has(action.value)
  )
}

/** One key source's actions with each run of typed keys collapsed to a single masked press, so the count does not survive. */
function maskKeyActions(actions: unknown[]): unknown[] {
  const out: unknown[] = []
  let run = ''
  let members: unknown[] = []
  let held: unknown[] = []
  let shifted = false
  let typed = false
  const flush = () => {
    if (typed) {
      rememberTyped(run)
      out.push(
        { type: 'keyDown', value: MASKED_VALUE },
        { type: 'keyUp', value: MASKED_VALUE }
      )
    } else {
      out.push(...members)
    }
    out.push(...held)
    run = ''
    typed = false
    members = []
    held = []
  }
  for (const action of actions) {
    const key = (action ?? {}) as KeyAction
    if (isShift(key) || isTypedKey(key)) {
      if (isTypedKey(key)) {
        typed = true
        run +=
          key.type === 'keyDown'
            ? shifted
              ? key.value.toUpperCase()
              : key.value
            : ''
      } else {
        shifted = key.type === 'keyDown'
      }
      members.push(...held, action)
      held = []
    } else if (members.length > 0 && key.type === 'pause') {
      held.push(action)
    } else {
      flush()
      out.push(action)
    }
  }
  flush()
  return out
}

/** A W3C action sequence with every key source's typing masked; pointer and wheel sources are kept. */
function maskActions(sources: unknown): unknown {
  if (!Array.isArray(sources)) {
    return sources
  }
  return sources.map((source) => {
    const { type, actions } = (source ?? {}) as {
      type?: unknown
      actions?: unknown
    }
    return type === 'key' && Array.isArray(actions)
      ? { ...(source as object), actions: maskKeyActions(actions) }
      : source
  })
}

// Only the mirror vectors reach this in TypeScript: Python's W3C payloads.
function maskParams(params: unknown, positions: 'params' | 'actions'): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params
  }
  const bag = params as Record<string, unknown>
  if (positions === 'actions') {
    return { ...bag, actions: maskActions(bag.actions) }
  }
  const masked: Record<string, unknown> = { ...bag }
  if ('text' in bag) {
    masked.text = maskTyped(bag.text, false)
  }
  // The wire splits the text into one entry per character, so masking each would still count them.
  if (Array.isArray(bag.value)) {
    masked.value = [maskTypedString(bag.value.map(String).join(''), false)]
  }
  return masked
}

function lastDataIndex(args: readonly unknown[]): number {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] !== 'function' && args[i] !== '[Function]') {
      return i
    }
  }
  return -1
}

/** `args` as the row carries them, typed text masked and remembered for scrubbing; `args` itself is never changed. */
export function maskCommandArgs(
  vocabulary: TypedCommandVocabulary,
  command: string,
  args: unknown[]
): unknown[] {
  const positions = mask.inputs
    ? TYPED_COMMANDS[vocabulary][command]
    : undefined
  if (!positions || args.length === 0) {
    return args
  }
  if (positions === 'params' || positions === 'actions') {
    return vocabulary === 'webdriver'
      ? args.map((params) => maskParams(params, positions))
      : args.map((arg, i) => (i === 0 ? maskActions(arg) : arg))
  }
  const namedKeys = command === 'keys'
  if (positions === 'all') {
    return args.map((arg) => maskTyped(arg, namedKeys))
  }
  const last = lastDataIndex(args)
  return args.map((arg, i) => (i === last ? maskTyped(arg, namedKeys) : arg))
}

/** A string equal to a typed value is masked whatever its length; one containing it, only past `SCRUB_MIN_LENGTH`. */
export function scrubTypedText(text: string): string {
  if (typedValues.size === 0 || !text) {
    return text
  }
  if (typedValues.has(text)) {
    return MASKED_VALUE
  }
  if (text.length < SCRUB_MIN_LENGTH) {
    return text
  }
  if (pattern === undefined) {
    pattern = typedValuePattern(typedValues.keys())
  }
  return pattern ? text.replace(pattern, MASKED_VALUE) : text
}

/** `value` with every string inside it scrubbed; objects are copied only where something changed. */
export function scrubTyped<T>(value: T): T {
  if (typedValues.size === 0) {
    return value
  }
  return scrubDeep(value, 0, { left: SCRUB_NODES_MAX }) as T
}

const SCRUB_DEPTH_MAX = 32
/** A walk visits at most this many values, so a huge result costs a bounded scan. */
const SCRUB_NODES_MAX = 10_000

/** Only data is walked: a live object (a WebdriverIO element, a Buffer) is neither read through nor copied. */
function isPlainData(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return Array.isArray(value) || proto === Object.prototype || proto === null
}

function scrubDeep(
  value: unknown,
  depth: number,
  budget: { left: number }
): unknown {
  if (budget.left-- <= 0) {
    return value
  }
  if (typeof value === 'string') {
    return scrubTypedText(value)
  }
  if (
    !value ||
    typeof value !== 'object' ||
    depth > SCRUB_DEPTH_MAX ||
    !isPlainData(value)
  ) {
    return value
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((item) => {
      const next = scrubDeep(item, depth + 1, budget)
      changed ||= next !== item
      return next
    })
    return changed ? out : value
  }
  let out: Record<string, unknown> | undefined
  for (const [key, item] of Object.entries(value)) {
    const next = scrubDeep(item, depth + 1, budget)
    if (next !== item) {
      out ??= { ...(value as Record<string, unknown>) }
      out[key] = next
    }
  }
  return out ?? value
}

/** Scrub a row's text-bearing fields in place, so the row the dashboard is sent and the row the trace writes agree. */
export function scrubTypedRow(row: CommandLog): void {
  if (typedValues.size === 0) {
    return
  }
  row.args = scrubTyped(row.args)
  row.result = scrubTyped(row.result)
  if (row.error) {
    row.error = scrubTyped(row.error)
  }
  if (row.title) {
    row.title = scrubTypedText(row.title)
  }
}

/** A request body can carry what was typed (a login POST); the url and headers are kept. */
export function scrubTypedBodies(request: NetworkRequest): void {
  if (typedValues.size === 0) {
    return
  }
  if (request.requestBody) {
    request.requestBody = scrubTypedText(request.requestBody)
  }
  if (request.responseBody) {
    request.responseBody = scrubTypedText(request.responseBody)
  }
}

/** Fields of a suite tree that quote values: a test's error. Titles, files and call sites are names, never scrubbed. */
const SUITE_ERROR_FIELDS: ReadonlySet<string> = new Set(['error', 'errors'])

/** Scrub each test's error in a suite tree in place, so the tree the adapter keeps and resends stays scrubbed. */
export function scrubSuiteErrors<T>(tree: T): T {
  if (typedValues.size > 0) {
    scrubErrorsIn(tree, 0, new WeakSet())
  }
  return tree
}

function scrubErrorsIn(
  node: unknown,
  depth: number,
  seen: WeakSet<object>
): void {
  if (!node || typeof node !== 'object' || depth > SCRUB_DEPTH_MAX) {
    return
  }
  if (seen.has(node)) {
    return
  }
  seen.add(node)
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (SUITE_ERROR_FIELDS.has(key)) {
      record[key] = scrubErrorField(record[key])
    } else {
      scrubErrorsIn(record[key], depth + 1, seen)
    }
  }
}

/** An Error's fields the dashboard shows; an assertion library may add the compared values. */
type AssertionError = Error & {
  expected?: unknown
  actual?: unknown
  matcherResult?: unknown
}

/** A plain, scrubbed copy of `err`: its own fields would not survive JSON, and the runner's Error is never changed. */
export function scrubbedErrorCopy(err: Error): Error {
  const raw = err as AssertionError
  return scrubTyped({
    ...raw,
    message: raw.message,
    name: raw.name,
    stack: raw.stack,
    expected: raw.expected,
    actual: raw.actual,
    matcherResult: raw.matcherResult
  }) as Error
}

function scrubErrorField(value: unknown): unknown {
  if (value instanceof Error) {
    return scrubbedErrorCopy(value)
  }
  if (Array.isArray(value)) {
    return value.map(scrubErrorField)
  }
  return scrubTyped(value)
}
