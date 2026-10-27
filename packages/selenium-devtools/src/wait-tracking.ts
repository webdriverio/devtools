import { AsyncLocalStorage } from 'node:async_hooks'
import logger from '@wdio/logger'
import { getCallSourceFromStack } from './helpers/utils.js'
import type {
  CapturedCommand,
  Patchable,
  WaitScope,
  WebElementPromiseCtor
} from './types.js'

const log = logger('@wdio/selenium-devtools:waitTracking')

const WAIT_TRACKED_SYMBOL = Symbol.for('@wdio/selenium-devtools/wait-tracked')

/** Set while a `driver.wait()` evaluates its condition: the polls it issues. */
const waitPoll = new AsyncLocalStorage<WaitScope>()

/** The `driver.wait()` the current command is a poll of, if any. */
export function currentWaitScope(): WaitScope | undefined {
  return waitPoll.getStore()
}

/** Marks a wait's own polls and reports a wait that rejects as a row of its own. */
export function trackWaits(
  proto: Patchable,
  emit: (cmd: CapturedCommand) => void,
  WebElementPromise?: WebElementPromiseCtor
): void {
  const original = proto.wait
  if (typeof original !== 'function' || proto[WAIT_TRACKED_SYMBOL]) {
    return
  }
  proto[WAIT_TRACKED_SYMBOL] = true
  proto.wait = function (
    this: unknown,
    condition: unknown,
    ...rest: unknown[]
  ) {
    const scope: WaitScope = { rows: new Map() }
    const fail = waitFailure(emit, scope, condition, rest[0])
    let result: unknown
    try {
      result = (original as (...a: unknown[]) => unknown).apply(this, [
        asWaitPoll(condition, scope),
        ...rest
      ])
    } catch (err) {
      fail(err)
      throw err
    }
    const thenable = result as PromiseLike<unknown> | null
    if (!thenable || typeof thenable.then !== 'function') {
      return result
    }
    // Rethrown, so the test's promise rejects (and goes unhandled) exactly as before.
    const observed = Promise.resolve(thenable).catch((err: unknown) => {
      fail(err)
      throw err
    })
    return WebElementPromise && result instanceof WebElementPromise
      ? new WebElementPromise(this, observed)
      : observed
  }
}

/** Emits a failed wait's row; the call site and label are resolved only on failure. */
function waitFailure(
  emit: (cmd: CapturedCommand) => void,
  scope: WaitScope,
  condition: unknown,
  timeout: unknown
): (err: unknown) => void {
  const startTime = Date.now()
  const stack = new Error().stack
  return (err) => {
    try {
      const label = conditionLabel(condition)
      emit({
        command: 'wait',
        args: timeout === undefined ? [label] : [label, timeout],
        result: undefined,
        error: err instanceof Error ? err : new Error(describeValue(err)),
        callSource: getCallSourceFromStack(stack).callSource,
        startTime,
        timestamp: Date.now(),
        fromElement: false,
        concludesWait: scope
      })
    } catch (rowErr) {
      // A row that cannot be built must not replace the wait's own rejection.
      log.warn(`Could not report a failed wait: ${describeValue(rowErr)}`)
    }
  }
}

function conditionLabel(condition: unknown): string {
  const describe = (condition as { description?: unknown } | null)?.description
  if (typeof describe === 'function') {
    return describeValue(describe.call(condition))
  }
  return typeof condition === 'function' ? '[Function]' : '[Promise]'
}

/** `String()` throws for a null-prototype object; a label must not. */
function describeValue(value: unknown): string {
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** A function condition, or a selenium `Condition` (its `fn`); a promise as is. */
function asWaitPoll(condition: unknown, scope: WaitScope): unknown {
  const inPoll =
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      waitPoll.run(scope, () => fn(...a))
  if (typeof condition === 'function') {
    return inPoll(condition as (...a: unknown[]) => unknown)
  }
  const fn = (condition as { fn?: unknown } | null)?.fn
  if (typeof fn === 'function') {
    return Object.assign(Object.create(condition as object), {
      fn: inPoll(fn as (...a: unknown[]) => unknown)
    })
  }
  return condition
}
