// What an element input command waits for before it reaches the driver.

import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'

import type { DriverPatcherHooks } from '../types.js'

const log = logger('@wdio/selenium-devtools:driverPatcher')

/** Element commands that dispatch input to the page. */
const INPUT_ELEMENT_METHODS = new Set(['click', 'sendKeys', 'clear', 'submit'])

/** What an element input waits for before it is sent: the focus switch, and for sendKeys the password-field read, so the row is redacted when it is sent. */
export function inputGate(
  hooks: DriverPatcherHooks,
  methodName: string,
  element: unknown,
  args: unknown[]
): Promise<void> | undefined {
  if (!INPUT_ELEMENT_METHODS.has(methodName)) {
    return undefined
  }
  const gates = [
    hooks.beforeInput?.(),
    methodName === 'sendKeys' ? hooks.beforeTyping?.(element, args) : undefined
  ].filter((gate): gate is Promise<void> => gate !== undefined)
  if (gates.length === 0) {
    return undefined
  }
  return Promise.all(
    gates.map((gate) =>
      gate.catch((err: unknown) =>
        log.warn(`input hook threw for ${methodName}: ${errorMessage(err)}`)
      )
    )
  ).then(() => undefined)
}
