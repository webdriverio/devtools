// One definition of a failed command row, shared by the trace exporter and the conformance comparison.

import {
  ASSERT_ACTION_CLASS,
  isWaitAction,
  type TraceAction
} from './trace-actions.js'
import type { CollapsedAssertResult, CommandLog } from './types.js'

/** The collapsed `{passed, actual, expected}` result an assertion row carries, when it carries one. */
export function collapsedAssertResult(
  result: unknown
): CollapsedAssertResult | undefined {
  if (typeof result === 'object' && result !== null && 'passed' in result) {
    return result as CollapsedAssertResult
  }
  return undefined
}

/** Why a row failed: its `error`, a collapsed result with `passed: false`, or a wait that resolved `false`; undefined when it did not fail. */
export function commandFailure(
  cmd: CommandLog,
  action: TraceAction
): { message: string } | undefined {
  if (cmd.error) {
    const err = cmd.error as { message?: string }
    return { message: err.message ?? String(cmd.error) }
  }
  const collapsed = collapsedAssertResult(cmd.result)
  if (collapsed && collapsed.passed === false) {
    const isAssert = action.class === ASSERT_ACTION_CLASS
    return {
      message: String(
        collapsed.message ??
          (isAssert ? 'Assertion failed' : `${cmd.command} failed`)
      )
    }
  }
  // Nightwatch hands a timed-out waitForElement* callback only `false`; scoped to waits since a boolean read may legitimately be false.
  if (cmd.result === false && isWaitAction(action)) {
    const target = cmd.args?.find((a) => typeof a === 'string')
    return {
      message: target
        ? `${cmd.command} timed out waiting for ${String(target)}`
        : `${cmd.command} timed out`
    }
  }
  return undefined
}
