import type { ActionSnapshot, CommandLog } from '@wdio/devtools-shared'
import { mapCommandToAction } from '@wdio/devtools-shared'
import {
  supersedeSnapshotAt,
  upsertRichestSnapshot
} from '@wdio/devtools-trace/trace-snapshots'
import {
  capturedPageState,
  finalFrameStamp,
  type FinalFrameCommand
} from './final-frame.js'

/**
 * Per-test state of the capture an adapter takes after each command. The
 * adapter decides whether a command may capture and supplies the capture call;
 * this owns the initial-frame retry, the generation guard and the end frame.
 */
export class TestCapture {
  /** True until the current test's first mapped command takes its capture. */
  awaitingInitialFrame = true
  initialFrameRetried = false
  generation = 0
  /** Timestamp of the latest command that queued a capture; the end-of-test frame is stamped there. */
  lastCapturedTimestamp: number | undefined = undefined
  startWallTime = 0

  reset(): void {
    this.awaitingInitialFrame = true
    this.initialFrameRetried = false
    this.generation++
    this.startWallTime = Date.now()
  }

  /**
   * `changesPage` is the adapter's call on whether the command can move the
   * page. Reads, waits and lookups skip the capture and inherit the earlier
   * one, except the test's first mapped command, which always takes one.
   */
  queue(
    command: string,
    timestamp: number,
    changesPage: boolean,
    snapshots: ActionSnapshot[],
    pending: Promise<void>[],
    capture: () => Promise<ActionSnapshot | null>
  ): Promise<void> | undefined {
    const initialFrame =
      this.awaitingInitialFrame && !!mapCommandToAction(command)
    if (!changesPage && !initialFrame) {
      return undefined
    }
    if (initialFrame) {
      this.awaitingInitialFrame = false
    }
    this.lastCapturedTimestamp = timestamp
    const generation = this.generation
    const settled = capture().then((snap) => {
      if (snap) {
        upsertRichestSnapshot(snapshots, snap)
      }
      // A capture resolving after reset() belongs to the previous test.
      if (
        initialFrame &&
        !snap?.screenshot &&
        !this.initialFrameRetried &&
        generation === this.generation
      ) {
        this.initialFrameRetried = true
        this.awaitingInitialFrame = true
      }
    })
    pending.push(settled)
    return settled
  }

  /** Stamped at the capture that last saw the page; supersedes its record only with a screenshot. */
  async captureEndFrame(
    commands: ReadonlyArray<CommandLog>,
    pending: Promise<void>[],
    snapshots: ActionSnapshot[],
    capture: (stamp: FinalFrameCommand) => Promise<ActionSnapshot | null>,
    onError: (err: unknown) => void
  ): Promise<void> {
    await Promise.all(pending)
    const stamp = finalFrameStamp(
      commands,
      this.startWallTime,
      this.lastCapturedTimestamp
    )
    if (!stamp) {
      return
    }
    try {
      const snap = await capture(stamp)
      if (snap && capturedPageState(snap)) {
        supersedeSnapshotAt(snapshots, snap)
      }
    } catch (err) {
      onError(err)
    }
  }
}
