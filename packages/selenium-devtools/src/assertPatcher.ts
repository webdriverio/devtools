import logger from '@wdio/logger'
import {
  patchNodeAssert as patchNodeAssertCore,
  type CapturedAssert
} from '@wdio/devtools-core'
import {
  selectorForElement,
  selectorForReadValue
} from './helpers/element-locators.js'
import type { CapturedCommand } from './types.js'

const log = logger('@wdio/selenium-devtools:assertPatcher')

/**
 * The element an assert was about. A Selenium test asserts on a value it read
 * out of the page (`assert.equal(await el.getText(), …)`), so the target is
 * recovered from the args: an element handle names its own locator, and any
 * other value names the element whose read produced it. First arg that resolves
 * wins — node:assert puts the subject first.
 */
export function resolveAssertTarget(args: unknown[]): string | undefined {
  for (const arg of args) {
    const selector = selectorForElement(arg) ?? selectorForReadValue(arg)
    if (selector) {
      return selector
    }
  }
  return undefined
}

/**
 * Selenium-specific wrapper around the core `patchNodeAssert`. Maps each
 * captured assert to selenium's wider `CapturedCommand` shape (adding the
 * `fromElement: false` bookkeeping field) and routes its logger through the
 * adapter's namespace.
 */
export function patchNodeAssert(
  onCommand: (cmd: CapturedCommand) => void
): boolean {
  return patchNodeAssertCore(
    (cmd: CapturedAssert) =>
      onCommand({
        ...cmd,
        // An assert is instantaneous, so its capture timestamp is also its start
        // — matching what core's own capturedAssertToCommandLog does.
        startTime: cmd.timestamp,
        rawResult: undefined,
        fromElement: false
      }),
    (level, message) => log[level](message),
    resolveAssertTarget
  )
}
