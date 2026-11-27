// Input masking learns a password as it is typed: a typing command reads its field's type in the queue, just before it runs.

import { noteTypedInput, readsFieldType } from '@wdio/devtools-core'
import { FIELD_TYPE_SCRIPT } from '@wdio/devtools-shared'

import { definitionSelector } from './assertTarget.js'
import { webdriverExecute } from './webdriverHttp.js'
import type { NightwatchBrowser } from '../types.js'

type Strategy = 'xpath' | 'css'

/** Commands that type text into the element they name: `(selector, text)` or `(using, selector, text)`. */
const TYPING_COMMANDS: ReadonlySet<string> = new Set([
  'setValue',
  'setPassword',
  'sendKeys',
  'updateValue'
])

/** The `using` values `FIELD_TYPE_SCRIPT` can resolve; another strategy (id, link text) reads no field. */
const SCRIPT_STRATEGIES: Readonly<Record<string, Strategy>> = {
  xpath: 'xpath',
  'css selector': 'css'
}

/** The strategy each browser's `useXpath()` / `useCss()` last set, in queue order, since the client keeps its own out of reach. */
const clientStrategy = new WeakMap<object, Strategy>()

/** Follows `useXpath()` and `useCss()`, so a bare selector resolves as the client would resolve it. */
function noteLocateStrategyCommand(
  browser: NightwatchBrowser,
  methodName: string
): void {
  if (methodName === 'useXpath' || methodName === 'useCss') {
    clientStrategy.set(browser, methodName === 'useXpath' ? 'xpath' : 'css')
  }
}

function defaultStrategy(browser: NightwatchBrowser): Strategy {
  const configured = (browser as { options?: { use_xpath?: unknown } }).options
  return (
    clientStrategy.get(browser) ??
    (configured?.use_xpath === true ? 'xpath' : 'css')
  )
}

/** Where a typing call's text sits: third after `(using, selector)`, else second. */
function textIndex(logArgs: unknown[]): number {
  const [first, second] = logArgs
  return typeof first === 'string' &&
    typeof second === 'string' &&
    logArgs.length >= 3
    ? 2
    : 1
}

/** A typing call's row records its text parts joined, as the field receives them, so a password split across parts is redacted whole. */
export function recordedTypingArgs(
  methodName: string,
  logArgs: unknown[]
): unknown[] {
  const index = textIndex(logArgs)
  const text = logArgs[index]
  const parts =
    TYPING_COMMANDS.has(methodName) &&
    Array.isArray(text) &&
    text.length > 1 &&
    text.every((part) => typeof part === 'string' || typeof part === 'number')
  if (!parts) {
    return logArgs
  }
  const recorded = [...logArgs]
  recorded[index] = text.join('')
  return recorded
}

interface TypingTarget {
  text: unknown
  /** Where `FIELD_TYPE_SCRIPT` finds the field; absent when the call names it in a way the script cannot resolve (id, link text, no selector). */
  field?: { selector: string; using: Strategy }
}

/** The text a typing call types and, when the script can resolve it, the field it types into. */
function typingTarget(
  browser: NightwatchBrowser,
  logArgs: unknown[]
): TypingTarget {
  const [first, second, third] = logArgs
  if (textIndex(logArgs) === 2) {
    const using = SCRIPT_STRATEGIES[first as string]
    return using
      ? { text: third, field: { selector: second as string, using } }
      : { text: third }
  }
  const selector = definitionSelector(first)
  const named = (first as { locateStrategy?: unknown } | null)?.locateStrategy
  const using =
    typeof named === 'string'
      ? SCRIPT_STRATEGIES[named]
      : defaultStrategy(browser)
  return selector && using
    ? { text: second, field: { selector, using } }
    : { text: second }
}

/** The raw transport and the script both answer null for a failure or no match, which must count as no answer, not as a field with no type. */
function answeredOrReject(type: unknown): unknown {
  if (type === null) {
    throw new Error('field type unanswered')
  }
  return type
}

/** Queues the field-type read ahead of a typing command, so its row and every frame sent while it types are redacted; a no-op for anything else. */
export function readFieldBeforeTyping(
  browser: NightwatchBrowser,
  methodName: string,
  logArgs: unknown[],
  nativeApp: boolean
): void {
  const perform = (browser as { perform?: unknown }).perform
  if (
    !TYPING_COMMANDS.has(methodName) ||
    nativeApp ||
    typeof perform !== 'function'
  ) {
    return
  }
  const { text, field } = typingTarget(browser, logArgs)
  if (!readsFieldType(text)) {
    return
  }
  // setPassword names its field a password; a field the script cannot locate is an unanswered read, which counts as one.
  const readFieldType =
    methodName === 'setPassword'
      ? () => Promise.resolve('password')
      : field
        ? () =>
            webdriverExecute(browser, FIELD_TYPE_SCRIPT, [
              field.selector,
              field.using
            ]).then(answeredOrReject)
        : undefined
  // Nightwatch awaits a promise an argument-less perform callback returns, before the typing command runs.
  perform.call(browser, () => noteTypedInput(text, readFieldType))
}

/** What the command proxy calls for every command before it is queued: follows the locate strategy and queues a typing command's field read. */
export function observeTyping(
  browser: NightwatchBrowser,
  cmd: { methodName: string; logArgs: unknown[] },
  session: { isNativeAppSession: boolean }
): void {
  noteLocateStrategyCommand(browser, cmd.methodName)
  readFieldBeforeTyping(
    browser,
    cmd.methodName,
    cmd.logArgs,
    session.isNativeAppSession
  )
}
