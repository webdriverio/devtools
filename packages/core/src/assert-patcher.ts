import { createRequire } from 'node:module'
import { TRACKED_ASSERT_METHODS, type CommandLog } from '@wdio/devtools-shared'
import { getCallSourceFromStack } from './stack.js'
import { toError } from './error.js'
import { stripAnsi } from './console.js'

export { TRACKED_ASSERT_METHODS }

const require = createRequire(import.meta.url)

/** Per-process guard so a second `patchNodeAssert()` call is a no-op. */
export const ASSERT_PATCHED_SYMBOL = Symbol.for(
  '@wdio/devtools-core/assert-patched'
)

/**
 * Minimum shape `patchNodeAssert` emits. Adapters that need extra bookkeeping
 * (selenium adds `fromElement` and `rawResult`) wrap the callback to extend
 * the object before forwarding to their own `onCommand` sink.
 */
export interface CapturedAssert {
  command: string
  args: unknown[]
  result: 'passed' | undefined
  error: Error | undefined
  callSource: string | undefined
  timestamp: number
}

/**
 * JSON-safe stringify of an assert argument. Non-serialisable inputs degrade
 * gracefully: functions → '[Function]', RegExp → `/.../i`, cyclic objects →
 * `String(value)`. Exported so adapters can mirror the shape if they wrap.
 */
export function safeSerializeAssertArg(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (value instanceof RegExp) {
    return value.toString()
  }
  if (typeof value === 'function') {
    return '[Function]'
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }
  return value
}

function makeAssertEmitters(
  methodName: string,
  args: unknown[],
  onCommand: (cmd: CapturedAssert) => void
): { passed: () => void; failed: (err: unknown) => void } {
  const callInfo = getCallSourceFromStack()
  // No user-code frame means the assert came from a dependency or framework
  // internal, not the user's test — drop it so it never reaches the trace.
  if (callInfo.filePath === undefined) {
    return { passed: () => {}, failed: () => {} }
  }
  const startedAt = Date.now()
  const sanitizedArgs = args.map(safeSerializeAssertArg)
  const emit = (result: 'passed' | undefined, error: Error | undefined) =>
    onCommand({
      command: `assert.${methodName}`,
      args: sanitizedArgs,
      result,
      error,
      callSource: callInfo.callSource,
      timestamp: startedAt
    })
  return {
    passed: () => emit('passed', undefined),
    failed: (err: unknown) => emit(undefined, toError(err))
  }
}

function makePatchedAssertMethod(
  methodName: string,
  assertObj: Record<string | symbol, unknown>,
  original: (...a: unknown[]) => unknown,
  onCommand: (cmd: CapturedAssert) => void
): (...args: unknown[]) => unknown {
  return function patchedAssert(this: unknown, ...args: unknown[]) {
    const { passed, failed } = makeAssertEmitters(methodName, args, onCommand)
    let result: unknown
    // Node's internalMatch dispatches on `fn === assert.match` (Node ≤20), so
    // a wrapper installed on that property silently inverts `match` into
    // `doesNotMatch`. Restore the original binding for the call so identity
    // checks inside node:assert see the real method.
    assertObj[methodName] = original
    try {
      result = original.apply(this, args)
    } catch (err) {
      failed(err)
      throw err
    } finally {
      assertObj[methodName] = patchedAssert
    }
    // Async assert methods (rejects/doesNotReject) return a Promise.
    const maybe = result as { then?: unknown } | null | undefined
    if (maybe && typeof maybe.then === 'function') {
      return (result as Promise<unknown>).then(
        (v) => {
          passed()
          return v
        },
        (err) => {
          failed(err)
          throw err
        }
      )
    }
    passed()
    return result
  }
}

/**
 * Convert a `CapturedAssert` into the shared `CommandLog` shape adapters push
 * into their session capturer. Asserts are effectively instantaneous, so the
 * capture timestamp doubles as `startTime`.
 */
export function capturedAssertToCommandLog(
  cmd: CapturedAssert,
  testUid?: string
): CommandLog {
  const entry: CommandLog = {
    command: cmd.command,
    args: cmd.args,
    result: cmd.result,
    timestamp: cmd.timestamp,
    startTime: cmd.timestamp
  }
  if (cmd.error) {
    entry.error = {
      name: cmd.error.name,
      message: cmd.error.message,
      stack: cmd.error.stack
    }
  }
  if (cmd.callSource) {
    entry.callSource = cmd.callSource
  }
  if (testUid) {
    entry.testUid = testUid
  }
  return entry
}

/**
 * Params any adapter's matcher tap produces. `prefix` selects the command
 * namespace (`expect` / `assert` / `verify`), all of which map to an `Assert`
 * action via the shared action map. Adapters do the thin framework-specific
 * extraction (matcher name, args, pass flag, message); this conversion is the
 * single shared path — the generic counterpart to `capturedAssertToCommandLog`
 * for libraries that aren't node:assert (expect-webdriverio, chai, Nightwatch).
 */
export interface MatcherAssertion {
  prefix?: string
  method: string
  args?: unknown[]
  passed: boolean
  message?: string | (() => string)
  callSource?: string
}

export function matcherAssertionToCommandLog(
  input: MatcherAssertion,
  testUid?: string
): CommandLog {
  const command = `${input.prefix ?? 'expect'}.${input.method}`
  const message =
    typeof input.message === 'function' ? input.message() : input.message
  return capturedAssertToCommandLog(
    {
      command,
      args: (input.args ?? []).map(safeSerializeAssertArg),
      result: input.passed ? 'passed' : undefined,
      error: input.passed
        ? undefined
        : new Error(stripAnsi(message ?? `${command} failed`)),
      callSource: input.callSource,
      timestamp: Date.now()
    },
    testUid
  )
}

/**
 * Patch `node:assert` so each tracked method emits a `CapturedAssert` to the
 * supplied hook. Idempotent across calls (guarded by `ASSERT_PATCHED_SYMBOL`).
 * Returns `true` on success, `false` when node:assert can't be resolved
 * (rare — browser-only Node-incompatible runtimes).
 *
 * Wraps both the function-form (`assert(...)`) and the namespace methods
 * (`assert.equal(...)`). User code that imported the methods BEFORE this
 * patcher loaded keeps stale references — adapters should import node:assert
 * from their main entry before user test files load.
 *
 * @param onCommand Callback invoked once per assert call (sync OR async).
 *                  Receives the captured shape; do NOT throw — the wrapper
 *                  re-throws the original assert error after the callback.
 * @param onLog     Optional logger for lifecycle events. Default: silent.
 */
export function patchNodeAssert(
  onCommand: (cmd: CapturedAssert) => void,
  onLog?: (level: 'info' | 'warn', message: string) => void
): boolean {
  const log = (level: 'info' | 'warn', message: string) =>
    onLog?.(level, message)

  let assertModule: unknown
  try {
    assertModule = require('node:assert')
  } catch {
    log('warn', 'node:assert not available — skipping assertion capture')
    return false
  }

  // Node's `assert` is a function with methods on it — cast once for the
  // symbol + dynamic method access we do here.
  const assertObj = assertModule as Record<string | symbol, unknown>
  if (assertObj[ASSERT_PATCHED_SYMBOL]) {
    return true
  }
  assertObj[ASSERT_PATCHED_SYMBOL] = true

  for (const methodName of TRACKED_ASSERT_METHODS) {
    const original = assertObj[methodName]
    if (typeof original !== 'function') {
      continue
    }
    assertObj[methodName] = makePatchedAssertMethod(
      methodName,
      assertObj,
      original as (...a: unknown[]) => unknown,
      onCommand
    )
  }

  log('info', `Patched ${TRACKED_ASSERT_METHODS.length} node:assert method(s)`)
  return true
}
