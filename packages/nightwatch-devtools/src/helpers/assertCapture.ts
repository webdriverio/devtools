// node:assert capture wiring: routes patched assertions into the session
// capturer through the same captureCommand path driver commands use, so
// retry bookkeeping and trace-mode action snapshots behave identically.

import logger from '@wdio/logger'
import {
  errorMessage,
  patchNodeAssert,
  resolveAssertTargetFromArgs,
  type CapturedAssert
} from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'

const log = logger('@wdio/nightwatch-devtools:assertCapture')

/**
 * Patch node:assert once per process. Getters are read at capture time — the
 * capturer is created lazily in session init and the test UID changes per test.
 */
export function wireAssertCapture(
  getCapturer: () => SessionCapturer | undefined,
  getTestUid: () => string | undefined
): void {
  patchNodeAssert(
    (cmd) => captureAssert(getCapturer(), getTestUid(), cmd),
    (level, message) => log[level](message),
    // No handle resolver: Nightwatch commands take selector strings, so an
    // element object never reaches an assert — only the value's provenance,
    // recorded by the command path (BrowserProxy), can name the target.
    (args) => resolveAssertTargetFromArgs(args)
  )
}

function captureAssert(
  capturer: SessionCapturer | undefined,
  testUid: string | undefined,
  cmd: CapturedAssert
): void {
  if (!capturer) {
    return
  }
  capturer
    .captureCommand(cmd.command, cmd.args, cmd.result, cmd.error, {
      testUid,
      callSource: cmd.callSource,
      timestamp: cmd.timestamp,
      // The assert's args hold the compared VALUES, so provenance — recorded by
      // the command path — is the row's only route to a locator.
      selector: cmd.selector
    })
    .catch((err) =>
      log.warn(`Failed to capture ${cmd.command}: ${errorMessage(err)}`)
    )
  // captureCommand pushes synchronously; mirror captureCommandError's send.
  const last = capturer.commandsLog[capturer.commandsLog.length - 1]
  if (last) {
    capturer.sendCommand(last)
  }
}
