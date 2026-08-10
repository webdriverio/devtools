/**
 * Binds the screencast recorder to a browser session, and rebinds it — and
 * nothing else — when that session is replaced mid-run.
 *
 * Nightwatch raises no session event, and `end` sits in
 * INTERNAL_COMMANDS_TO_IGNORE, so the command proxy never sees the call that
 * destroys the session. The BDD `describe/it` interface compounds it: the
 * plugin's `beforeEach` fires once per MODULE, so `ensureSessionInitialized` —
 * the only place that detects a session change — is never re-entered for a
 * `browser.end()` between `it`s. A command executing under a different
 * `sessionId` is the sole evidence the session was replaced.
 *
 * Rotation is deliberately narrower than `handleSessionChange`: that path also
 * rebuilds the SessionCapturer, which in trace mode would discard every command,
 * console line, network entry and mutation the run has accumulated. It leaves
 * `lastSessionId` alone for the same reason — that desync is what keeps the next
 * `ensureSessionInitialized` able to do the full re-arm (BiDi, collector
 * preload) this cannot.
 */

import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { ScreencastRecorder } from './screencast.js'
import type { SessionInitCtx } from './session-init.js'
import type { NightwatchBrowser } from './types.js'

const log = logger('@wdio/nightwatch-devtools:screencast-session')

/**
 * Start a fresh recorder for `sessionId` — every session gets its own, matching
 * the WDIO service. Polling mode only (Nightwatch exposes no stable CDP escape
 * hatch). Idempotent, so bringup and rotation share one path.
 */
export async function startScreencast(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser,
  sessionId: string | undefined
): Promise<void> {
  if (!ctx.screencastOptions.enabled || ctx.screencastRecorder || !sessionId) {
    return
  }
  ctx.screencastRecorder = new ScreencastRecorder(
    ctx.sessionCapturer,
    ctx.screencastOptions
  )
  ctx.screencastSessionId = sessionId
  log.info(`🎬 Starting screencast for session ${sessionId}`)
  await ctx.screencastRecorder.start(browser)
}

/**
 * Whether the recorder is bound to a session the browser has already left.
 * Requires BOTH a live recorder and a live session id: starting one from
 * nothing would strand a poll interval past the plugin's own teardown, which
 * finalizes the recorder before its last browser calls.
 */
export function needsScreencastRotation(
  ctx: Pick<SessionInitCtx, 'screencastRecorder' | 'screencastSessionId'>,
  sessionId: string | undefined
): boolean {
  return (
    ctx.screencastRecorder !== undefined &&
    sessionId !== undefined &&
    ctx.screencastSessionId !== sessionId
  )
}

/**
 * Observe one command. Rotation is fire-and-forget — a command must not wait on
 * a video encode — and parked on `ctx.screencastRotation`, which both latches
 * out the flood of commands arriving before it completes and gives teardown
 * something to await, so a rotation cannot start a recorder after the plugin
 * has already finalized.
 */
export function rotateScreencastForSession(
  ctx: SessionInitCtx,
  browser: NightwatchBrowser
): void {
  if (ctx.screencastRotation || !ctx.screencastOptions.enabled) {
    return
  }
  const sessionId = browser.sessionId ?? undefined
  if (!needsScreencastRotation(ctx, sessionId)) {
    return
  }
  log.info(`🎬 Session replaced — rotating screencast to ${sessionId}`)
  ctx.screencastRotation = ctx
    .finalizeCurrentScreencast()
    .then(() => startScreencast(ctx, browser, sessionId))
    .catch((err) =>
      log.warn(`Screencast rotation failed: ${errorMessage(err)}`)
    )
    .finally(() => {
      ctx.screencastRotation = undefined
    })
}
