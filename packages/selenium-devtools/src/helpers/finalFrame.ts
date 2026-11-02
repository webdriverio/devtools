import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { captureActionSnapshot } from '../action-snapshot.js'
import type { SessionLifecycleCtx } from '../session-lifecycle.js'

const log = logger('@wdio/selenium-devtools:finalFrame')

/** Rows after the test's last capture saw a state nothing captured; one more capture, stamped at that capture, shows the test's end. */
export async function captureFinalFrame(
  ctx: SessionLifecycleCtx
): Promise<void> {
  const capturer = ctx.sessionCapturer
  if (
    ctx.options.mode !== 'trace' ||
    ctx.finalized ||
    !ctx.driver ||
    !capturer
  ) {
    return
  }
  await capturer.testCapture.captureEndFrame(
    capturer.commandsLog,
    ctx.snapshotCaptures,
    ctx.actionSnapshots,
    // ctx.driver is read after the pending captures settle: a driver swap meanwhile must be honoured.
    (stamp) =>
      ctx.driver
        ? captureActionSnapshot(
            ctx.driver,
            stamp.command,
            stamp.timestamp,
            capturer.isNativeAppSession,
            'final'
          )
        : Promise.resolve(null),
    (err) => log.debug(`End-of-test frame capture failed: ${errorMessage(err)}`)
  )
}
