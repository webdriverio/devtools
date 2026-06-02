import logger from '@wdio/logger'
import {
  patchNodeAssert as patchNodeAssertCore,
  type CapturedAssert
} from '@wdio/devtools-core'
import type { CapturedCommand } from './types.js'

const log = logger('@wdio/selenium-devtools:assertPatcher')

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
        rawResult: undefined,
        fromElement: false
      }),
    (level, message) => log[level](message)
  )
}
