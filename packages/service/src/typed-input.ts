// Input masking learns a password as it is typed: setValue and addValue both reach the driver as elementSendKeys.

import { noteTypedInput } from '@wdio/devtools-core'
import { isNativeAppSession } from '@wdio/devtools-shared'

import { directProbes } from './direct-probes.js'

/** The direct probe answers undefined for a failed read as well as for an element with no type, so it counts as no answer. */
function answeredOrReject(type: string | undefined): string {
  if (type === undefined) {
    throw new Error('field type unanswered')
  }
  return type
}

/** The field-type reads of the run's elementSendKeys commands, started in beforeCommand and awaited only before a row is recorded. */
export class TypedInputReads {
  #pending: Promise<void>[] = []

  /** Starts the read for an elementSendKeys without holding its hook; `args[0]` is the element id. */
  read(browser: WebdriverIO.Browser, command: string, args: unknown[]): void {
    const elementId = args[0]
    if (
      command !== 'elementSendKeys' ||
      typeof elementId !== 'string' ||
      isNativeAppSession(browser.capabilities)
    ) {
      return
    }
    // Appium serialises a session, so a read from inside the command's hook goes straight to the driver there (#374).
    const direct = directProbes(browser)
    this.#pending.push(
      noteTypedInput(args[1], () =>
        direct
          ? direct.getElementType(elementId).then(answeredOrReject)
          : browser.getElementProperty(elementId, 'type')
      )
    )
  }

  /** Every read started so far, or undefined when none is pending, so a caller adds no tick for a command that typed nothing. */
  settled(): Promise<unknown> | undefined {
    if (this.#pending.length === 0) {
      return undefined
    }
    const pending = Promise.all(this.#pending)
    this.#pending = []
    return pending
  }
}
