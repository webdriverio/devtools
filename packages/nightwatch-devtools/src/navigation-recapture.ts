import logger from '@wdio/logger'
import {
  capturedPageState,
  errorMessage,
  supersedeSnapshotAt
} from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { captureActionSnapshot } from './action-snapshot.js'
import type { NightwatchBrowser, TestRunnerId } from './types.js'

const log = logger('@wdio/nightwatch-devtools:navigationRecapture')

/** A per-action capture a command queued, kept so a navigation seen after the command returns can supersede it once it has settled. */
export interface QueuedPageCapture {
  command: string
  timestamp: number
  settled: Promise<void>
}

export interface NavigationRecapture {
  browser: NightwatchBrowser
  runner: TestRunnerId
  native: boolean
  snapshots: ActionSnapshot[]
  queued: QueuedPageCapture
  /** False once a newer page capture has been queued; its own capture then reads the newer state. */
  isLatest: () => boolean
}

/**
 * A click resolves before its navigation commits, so the capture it queued can
 * read the page it left. The replacement is taken after that capture settles,
 * because a late upsert would otherwise merge the stale screenshot back over it.
 */
export async function recaptureAfterNavigation({
  browser,
  runner,
  native,
  snapshots,
  queued,
  isLatest
}: NavigationRecapture): Promise<void> {
  try {
    await queued.settled
    const snap = await captureActionSnapshot(
      browser,
      queued.command,
      queued.timestamp,
      runner,
      native
    )
    if (snap && capturedPageState(snap) && isLatest()) {
      supersedeSnapshotAt(snapshots, snap)
    }
  } catch (err) {
    log.debug(`Post-navigation capture failed: ${errorMessage(err)}`)
  }
}
