/**
 * The plugin's screencast seam: what a run's mode and filmstrip/video options
 * imply for the recorder, plus the per-run frame buffer the trace filmstrip and
 * the per-test video slices are cut from.
 *
 * The recorder itself is `screencast.ts`, and binding it to a session — or
 * rotating it when the session is replaced — is `screencast-session.ts`. This is
 * the plugin-level state those two hang off, split out of `index.ts` so the
 * plugin keeps only its accessor bag and thin delegators.
 */

import { accumulatedScreencastFrames } from '@wdio/devtools-core'
import { SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'
import { finalizeCurrentScreencast } from './session-init.js'
import type { SessionInitCtx } from './session-init.js'
import type { ScreencastRecorder } from './screencast.js'
import type {
  DevToolsMode,
  ScreencastFrame,
  ScreencastOptions,
  TraceVideoPolicy
} from './types.js'

/** The already-defaulted options the recorder decision is made from — read the
 *  resolved `filmstrip`/`video`, never the raw `options.filmstrip`, or a
 *  default-on filmstrip leaves the recorder inert while the plugin's own options
 *  claim it is running. */
export interface ScreencastResolutionInput {
  mode: DevToolsMode
  filmstrip: boolean
  video: TraceVideoPolicy
  screencast: ScreencastOptions | undefined
}

export interface ResolvedScreencast {
  /** What the plugin exposes as `options.screencast`. */
  options: ScreencastOptions
  /** Config warning to log, when the mode makes the option meaningless. */
  warning?: string
}

/**
 * Whether this run records a screencast, and under which options. Filmstrip OR a
 * produce-only per-test video drives the recorder in trace mode; bare screencast
 * with neither is a live-mode feature and is dropped there.
 */
export function resolveScreencastOptions(
  input: ScreencastResolutionInput
): ResolvedScreencast {
  const screencast = input.screencast ?? {}
  if (input.mode !== 'trace') {
    return { options: screencast }
  }
  if (input.filmstrip || input.video !== 'off') {
    return { options: { ...screencast, enabled: true } }
  }
  if (screencast.enabled === true) {
    return {
      options: {},
      warning: 'trace mode: ignoring screencast option (live-mode feature)'
    }
  }
  return { options: screencast }
}

/**
 * One run's screencast state: the live recorder and the session it is bound to,
 * an in-flight rotation, and the frames drained from recorders already finalized.
 */
export class PluginScreencast {
  /** Recorder options with the shared defaults applied. */
  readonly options: ScreencastOptions
  recorder?: ScreencastRecorder
  sessionId?: string
  /** In-flight recorder rotation — see `screencast-session.ts`. */
  rotation?: Promise<void>

  // Snapshotted before each recorder is nulled, so the export isn't blank.
  #accumulated: ScreencastFrame[] = []
  readonly #keepFrames: boolean

  /** `keepFrames` when the trace filmstrip or a per-test video will consume
   *  them; without either, a finalized recorder's frames are of no further use. */
  constructor(options: ScreencastOptions, keepFrames: boolean) {
    this.options = { ...SCREENCAST_DEFAULTS, ...options }
    this.#keepFrames = keepFrames
  }

  /** Every frame this run has produced — the finalized recorders' plus the live
   *  one's, so a mid-run slice flush (which fires before the recorder is
   *  drained) isn't blank. */
  get frames(): ScreencastFrame[] {
    return accumulatedScreencastFrames(this.#accumulated, this.recorder)
  }

  /** Drain the live recorder into the run buffer, then stop and clear it. The
   *  drain has to precede the stop: `finalizeCurrentScreencast` nulls the
   *  recorder, and with it the only reference to its frames. */
  async finalize(ctx: SessionInitCtx): Promise<void> {
    if (this.#keepFrames && this.recorder) {
      this.#accumulated.push(...this.recorder.frames)
    }
    await finalizeCurrentScreencast(ctx)
  }
}
