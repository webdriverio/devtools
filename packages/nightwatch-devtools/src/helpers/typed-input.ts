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

/** The field, strategy and text a typing call names, or undefined when the script cannot resolve its field. */
function typingTarget(
  browser: NightwatchBrowser,
  logArgs: unknown[]
): { selector: string; using: Strategy; text: unknown } | undefined {
  const [first, second, third] = logArgs
  if (
    typeof first === 'string' &&
    typeof second === 'string' &&
    logArgs.length >= 3
  ) {
    const using = SCRIPT_STRATEGIES[first]
    return using ? { selector: second, using, text: third } : undefined
  }
  const selector = definitionSelector(first)
  if (!selector) {
    return undefined
  }
  const named = (first as { locateStrategy?: unknown } | null)?.locateStrategy
  const using =
    typeof named === 'string'
      ? SCRIPT_STRATEGIES[named]
      : defaultStrategy(browser)
  return using ? { selector, using, text: second } : undefined
}

/** Queues the field-type read ahead of a typing command, so its row and every frame sent while it types are redacted; a no-op for anything else. */
export function readFieldBeforeTyping(
  browser: NightwatchBrowser,
  methodName: string,
  logArgs: unknown[],
  nativeApp: boolean
): void {
  const target = TYPING_COMMANDS.has(methodName)
    ? typingTarget(browser, logArgs)
    : undefined
  const perform = (browser as { perform?: unknown }).perform
  if (
    !target ||
    !readsFieldType(target.text) ||
    nativeApp ||
    typeof perform !== 'function'
  ) {
    return
  }
  const { selector, using, text } = target
  // Nightwatch awaits a promise an argument-less perform callback returns, before the typing command runs.
  perform.call(browser, () =>
    noteTypedInput(text, () =>
      webdriverExecute(browser, FIELD_TYPE_SCRIPT, [selector, using])
    )
  )
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
