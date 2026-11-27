// Page-state captures for written traces: a native page source's tree and a screenshot whose header names its size.

import type { ActionSnapshot, CommandLog } from '@wdio/devtools-shared'
import { nativeSnapshotFromPageSource } from '@wdio/devtools-trace/native-snapshot'
import type { TraceHandle } from '../src/types.js'
import { openWritten } from './traces.js'

export const ANDROID_SOURCE =
  '<hierarchy><android.widget.FrameLayout bounds="[0,0][1080,2400]">' +
  '<android.widget.Button resource-id="com.app:id/start" text="Start" clickable="true" enabled="true" displayed="true" bounds="[100,200][300,400]"/>' +
  '</android.widget.FrameLayout></hierarchy>'

export const ANDROID_START_LOCATOR =
  'android=new UiSelector().resourceId("com.app:id/start")'

/** A PNG whose header names the size; nothing reads past it, so no pixel data follows. */
export function pngHeader(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  return Buffer.from(bytes).toString('base64')
}

/** A capture at `timestamp` with a screenshot, which the writer needs before any action can claim it. */
export function capture(
  timestamp: number,
  snapshotText: string
): ActionSnapshot {
  return {
    timestamp,
    command: 'click',
    screenshot: pngHeader(1080, 2400),
    snapshotText
  }
}

const TAP_THEN_READ: CommandLog[] = [
  { command: 'click', args: ['~start'], startTime: 1800, timestamp: 2000 },
  { command: 'getText', args: ['~start'], startTime: 2900, timestamp: 3000 }
]

/** A native app trace starting at the first action's start, with the page source's tree captured at each of `captureAt`: by default a tap that took one, then a read that took none. */
export function openNativeTrace(
  commands: CommandLog[] = TAP_THEN_READ,
  captureAt: readonly number[] = [2000]
): Promise<TraceHandle> {
  const { snapshotText } = nativeSnapshotFromPageSource(
    ANDROID_SOURCE,
    'android'
  )!
  return openWritten({
    commands,
    actionSnapshots: captureAt.map((at) => capture(at, snapshotText)),
    startTime: commands[0]!.timestamp
  })
}
