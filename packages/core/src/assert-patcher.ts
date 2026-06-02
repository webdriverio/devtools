import { createRequire } from 'node:module'
import { getCallSourceFromStack } from './stack.js'
import { toError } from './error.js'

const require = createRequire(import.meta.url)

/** Per-process guard so a second `patchNodeAssert()` call is a no-op. */
export const ASSERT_PATCHED_SYMBOL = Symbol.for(
  '@wdio/devtools-core/assert-patched'
)

/** node:assert methods the patcher wraps. */
export const TRACKED_ASSERT_METHODS = [
  'equal',
  'strictEqual',
  'deepEqual',
  'deepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'notDeepEqual',
  'notDeepStrictEqual',
  'ok',
  'fail',
  'throws',
  'doesNotThrow',
  'rejects',
  'doesNotReject',
  'match',
  'doesNotMatch'
] as const

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

  const wrapMethod = (methodName: string) => {
    const original = assertObj[methodName]
    if (typeof original !== 'function') {
      return
    }
    assertObj[methodName] = function patchedAssert(
      this: unknown,
      ...args: unknown[]
    ) {
      const callInfo = getCallSourceFromStack()
      const startedAt = Date.now()
      const sanitizedArgs = args.map(safeSerializeAssertArg)

      const passed = () =>
        onCommand({
          command: `assert.${methodName}`,
          args: sanitizedArgs,
          result: 'passed',
          error: undefined,
          callSource: callInfo.callSource,
          timestamp: startedAt
        })
      const failed = (err: unknown) =>
        onCommand({
          command: `assert.${methodName}`,
          args: sanitizedArgs,
          result: undefined,
          error: toError(err),
          callSource: callInfo.callSource,
          timestamp: startedAt
        })

      try {
        const result = (original as (...a: unknown[]) => unknown).apply(
          this,
          args
        )
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
      } catch (err) {
        failed(err)
        throw err
      }
    }
  }

  for (const m of TRACKED_ASSERT_METHODS) {
    wrapMethod(m)
  }

  log('info', `Patched ${TRACKED_ASSERT_METHODS.length} node:assert method(s)`)
  return true
}
