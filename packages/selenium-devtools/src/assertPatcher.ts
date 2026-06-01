import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { toError } from '@wdio/devtools-core'
import { ASSERT_PATCHED_SYMBOL, TRACKED_ASSERT_METHODS } from './constants.js'
import { getCallSourceFromStack } from './helpers/utils.js'
import type { CapturedCommand } from './types.js'

const log = logger('@wdio/selenium-devtools:assertPatcher')
const require = createRequire(import.meta.url)

function safeSerialize(value: any): any {
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
 * Patch `node:assert` so each tracked method emits a `CapturedCommand` to
 * the supplied hook. Idempotent — calling twice doesn't double-wrap.
 *
 * Note: we patch BOTH the function-form (`assert(...)`) and the namespace
 * methods (`assert.equal(...)`). User code that imported the methods BEFORE
 * this patcher loaded will already have stale references — to be safe,
 * the plugin's main entry imports node:assert before the user's test files.
 */
export function patchNodeAssert(
  onCommand: (cmd: CapturedCommand) => void
): boolean {
  let assertModule: any
  try {
    assertModule = require('node:assert')
  } catch {
    log.warn('node:assert not available — skipping assertion capture')
    return false
  }

  if ((assertModule as any)[ASSERT_PATCHED_SYMBOL]) {
    return true
  }
  ;(assertModule as any)[ASSERT_PATCHED_SYMBOL] = true

  // Wrap each tracked method on `assert` and `assert.strict`. We don't
  // overwrite `assert.strict.equal` separately because Node's strict
  // namespace shares method bodies internally — patching the surface is
  // enough.
  const wrapMethod = (methodName: string) => {
    const original = (assertModule as any)[methodName]
    if (typeof original !== 'function') {
      return
    }
    ;(assertModule as any)[methodName] = function patchedAssert(
      ...args: any[]
    ) {
      const callInfo = getCallSourceFromStack()
      const startedAt = Date.now()
      const sanitizedArgs = args.map(safeSerialize)

      try {
        const result = original.apply(this, args)
        // Async assert methods (rejects/doesNotReject) return a Promise.
        if (result && typeof result.then === 'function') {
          return result.then(
            (v: any) => {
              onCommand({
                command: `assert.${methodName}`,
                args: sanitizedArgs,
                result: 'passed',
                error: undefined,
                callSource: callInfo.callSource,
                timestamp: startedAt,
                fromElement: false
              })
              return v
            },
            (err: any) => {
              onCommand({
                command: `assert.${methodName}`,
                args: sanitizedArgs,
                result: undefined,
                error: toError(err),
                callSource: callInfo.callSource,
                timestamp: startedAt,
                fromElement: false
              })
              throw err
            }
          )
        }
        onCommand({
          command: `assert.${methodName}`,
          args: sanitizedArgs,
          result: 'passed',
          error: undefined,
          callSource: callInfo.callSource,
          timestamp: startedAt,
          fromElement: false
        })
        return result
      } catch (err) {
        onCommand({
          command: `assert.${methodName}`,
          args: sanitizedArgs,
          result: undefined,
          error: err instanceof Error ? err : new Error(String(err)),
          callSource: callInfo.callSource,
          timestamp: startedAt,
          fromElement: false
        })
        throw err
      }
    }
  }

  for (const m of TRACKED_ASSERT_METHODS) {
    wrapMethod(m)
  }

  log.info(`Patched ${TRACKED_ASSERT_METHODS.length} node:assert method(s)`)
  return true
}
