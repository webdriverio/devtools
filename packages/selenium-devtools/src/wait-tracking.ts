import { AsyncLocalStorage } from 'node:async_hooks'
import logger from '@wdio/logger'
import { errorMessage, toError } from '@wdio/devtools-core'
import { getCallSourceFromStack } from './helpers/utils.js'
import {
  locatorToSelector,
  rememberElementLocator,
  selectorForElement
} from './helpers/element-locators.js'
import type {
  CapturedCommand,
  Patchable,
  WaitPoll,
  WaitScope,
  WebElementPromiseCtor
} from './types.js'

const log = logger('@wdio/selenium-devtools:waitTracking')

const WAIT_TRACKED_SYMBOL = Symbol.for('@wdio/selenium-devtools/wait-tracked')

/** Set while a `driver.wait()` evaluates its condition: the polls it issues. */
const waitPoll = new AsyncLocalStorage<WaitPoll>()

/** The wait this command polls for, keyed as the nth call with this command, args and target, which every evaluation repeats. */
export function waitPollOf(
  command: string,
  args: unknown[],
  selector: string | undefined
): { waitScope: WaitScope; pollKey: string } | undefined {
  const poll = waitPoll.getStore()
  if (!poll) {
    return undefined
  }
  const call = JSON.stringify({ command, args, selector: selector ?? null })
  const nth = poll.seen.get(call) ?? 0
  poll.seen.set(call, nth + 1)
  return { waitScope: poll.scope, pollKey: `${call}#${nth}` }
}

/** What an element condition waits for, recorded when `until` builds it, since the condition keeps its target in a closure. */
const elementConditions = new WeakMap<
  object,
  { command: string; selector: () => string | undefined }
>()

/** Names a wait on `until.elementLocated` / `until.elementIsVisible` after its element rather than its condition. */
export function tagElementConditions(until: Patchable | undefined): void {
  if (!until || until[WAIT_TRACKED_SYMBOL]) {
    return
  }
  until[WAIT_TRACKED_SYMBOL] = true
  const tag = (
    name: string,
    command: string,
    selectorOf: (target: unknown) => () => string | undefined
  ) => {
    const original = until[name]
    if (typeof original !== 'function') {
      return
    }
    until[name] = function (
      this: unknown,
      target: unknown,
      ...rest: unknown[]
    ) {
      const condition: unknown = (
        original as (...a: unknown[]) => unknown
      ).apply(this, [target, ...rest])
      if (condition && typeof condition === 'object') {
        elementConditions.set(condition, {
          command,
          selector: selectorOf(target)
        })
      }
      return condition
    }
  }
  tag('elementLocated', 'waitForElementLocated', (locator) => {
    const selector = locatorToSelector(locator)
    return () => selector
  })
  // An element's locator is known once the find that produced it has resolved, which can be after the condition is built.
  tag(
    'elementIsVisible',
    'waitForElementVisible',
    (element) => () => selectorForElement(element)
  )
}

type WaitOutcome = { value: unknown } | { error: unknown }

/** Sends a wait's row when it is called, so what its condition issues nests under it, and replaces the row when it settles. */
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
    const outer = waitPoll.getStore()
    const scope = scopeFor(outer, condition)
    const settle = openWaitRow(emit, outer?.scope, scope, condition, rest[0])
    let result: unknown
    try {
      result = (original as (...a: unknown[]) => unknown).apply(this, [
        asWaitPoll(condition, scope),
        ...rest
      ])
    } catch (error) {
      settle({ error })
      throw error
    }
    const thenable = result as PromiseLike<unknown> | null
    if (!thenable || typeof thenable.then !== 'function') {
      settle({ value: result })
      return result
    }
    // Rethrown, so the test's promise rejects (and goes unhandled) exactly as before.
    const observed = Promise.resolve(thenable).then(
      (value: unknown) => {
        settle({ value })
        return value
      },
      (error: unknown) => {
        settle({ error })
        throw error
      }
    )
    return asReturned(this, result, observed, condition, WebElementPromise)
  }
}

/**
 * What the patched wait hands back: selenium's own element promise around the observed outcome when the wait returned
 * one, which `driver.wait(...).getText()` chains on. It is a new handle, so the condition's locator is recorded on it.
 */
function asReturned(
  driver: unknown,
  result: unknown,
  observed: Promise<unknown>,
  condition: unknown,
  WebElementPromise?: WebElementPromiseCtor
): unknown {
  if (!WebElementPromise || !(result instanceof WebElementPromise)) {
    return observed
  }
  const element = new WebElementPromise(driver, observed)
  rememberElementLocator(element, elementSelectorOf(condition))
  return element
}

function elementSelectorOf(condition: unknown): string | undefined {
  return condition && typeof condition === 'object'
    ? elementConditions.get(condition)?.selector()
    : undefined
}

/** What a wait's row is named: an element condition after its element and its selector, any other condition `wait`. */
export function waitRowName(condition: unknown): {
  command: string
  selector: string | undefined
} {
  const element =
    condition && typeof condition === 'object'
      ? elementConditions.get(condition)
      : undefined
  return {
    command: element?.command ?? 'wait',
    selector: elementSelectorOf(condition)
  }
}

/** Emits the wait's running row, stamped when this call started and spanning from the wait's first, and returns what replaces it once the wait settles. */
function openWaitRow(
  emit: (cmd: CapturedCommand) => void,
  parent: WaitScope | undefined,
  scope: WaitScope,
  condition: unknown,
  timeout: unknown
): (outcome: WaitOutcome) => void {
  const now = Date.now()
  const startTime = (scope.startTime ??= now)
  let opened: CapturedCommand | undefined
  try {
    opened = {
      ...waitRow(parent, scope, condition, timeout, startTime),
      timestamp: now
    }
    emit({ ...opened, running: true })
  } catch (rowErr) {
    // A row that cannot be built must not break the wait itself.
    log.warn(`Could not report a wait: ${errorMessage(rowErr)}`)
  }
  return (outcome) => {
    if (!opened) {
      return
    }
    try {
      emit({
        ...opened,
        rawResult: 'value' in outcome ? outcome.value : undefined,
        error: 'error' in outcome ? toError(outcome.error) : undefined,
        timestamp: Date.now()
      })
    } catch (rowErr) {
      // A row that cannot be built must not replace the wait's own outcome.
      log.warn(`Could not report a settled wait: ${errorMessage(rowErr)}`)
    }
  }
}

/** An element condition is named after its element and carries its selector; any other after its condition. */
function waitRow(
  parent: WaitScope | undefined,
  scope: WaitScope,
  condition: unknown,
  timeout: unknown,
  startTime: number
): CapturedCommand {
  const { command, selector } = waitRowName(condition)
  const subject = selector ?? conditionLabel(condition)
  return {
    command,
    args: timeout === undefined ? [subject] : [subject, timeout],
    result: undefined,
    error: undefined,
    callSource: getCallSourceFromStack().callSource,
    startTime,
    timestamp: startTime,
    fromElement: false,
    selector,
    waitScope: parent,
    wait: scope
  }
}

function conditionLabel(condition: unknown): string {
  const describe = (condition as { description?: unknown } | null)?.description
  if (typeof describe === 'function') {
    const text: unknown = describe.call(condition)
    return typeof text === 'string' ? text : toError(text).message
  }
  return typeof condition === 'function' ? '[Function]' : '[Promise]'
}

/** A wait inside another wait's condition is the same wait on every outer poll, so it keeps one scope, and one row, across them. */
function scopeFor(outer: WaitPoll | undefined, condition: unknown): WaitScope {
  if (!outer) {
    return { rows: new Map() }
  }
  // Keyed like a poll, by what the wait is and the nth time this evaluation issued it, so two waits in different branches stay apart.
  const call = `wait ${nestedWaitIdentity(condition)}`
  const nth = outer.seen.get(call) ?? 0
  outer.seen.set(call, nth + 1)
  const nested = (outer.scope.nested ??= new Map())
  const key = `${call}#${nth}`
  const scope = nested.get(key) ?? { rows: new Map() }
  nested.set(key, scope)
  return scope
}

/** Where the wait was called, what it waits for, and its condition's source: the same on every outer poll, different between two waits. */
function nestedWaitIdentity(condition: unknown): string {
  const fn =
    typeof condition === 'function'
      ? condition
      : (condition as { fn?: unknown } | null)?.fn
  let label: string
  try {
    label = conditionLabel(condition)
  } catch (err) {
    label = errorMessage(err)
  }
  return JSON.stringify([
    getCallSourceFromStack(new Error().stack).callSource ?? null,
    label,
    typeof fn === 'function' ? fn.toString() : null
  ])
}

/** A function condition, or a selenium `Condition` (its `fn`); a promise as is. */
function asWaitPoll(condition: unknown, scope: WaitScope): unknown {
  const inPoll =
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      waitPoll.run({ scope, seen: new Map() }, () => fn(...a))
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
