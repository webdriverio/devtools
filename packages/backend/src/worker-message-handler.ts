import logger from '@wdio/logger'
import { WS_SCOPE } from '@wdio/devtools-shared'
import type { baselineStore as BaselineStore } from './baselineStore.js'
import type { testRunner as TestRunner } from './runner.js'

const log = logger('@wdio/devtools-backend')

export interface WorkerMessageContext {
  baselineStore: typeof BaselineStore
  testRunner: typeof TestRunner
  videoRegistry: Map<string, string>
  broadcastToClients: (message: string) => void
  clientCount: () => number
}

// Returns true if the message was fully handled and shouldn't be forwarded.
function tryHandleControlMessage(
  parsed: { scope?: string; data?: Record<string, unknown> },
  ctx: WorkerMessageContext
): boolean {
  if (parsed.scope === WS_SCOPE.clearCommands) {
    const testUid = parsed.data?.testUid
    log.info(`Clearing commands for test: ${testUid || 'all'}`)
    // Clearing without a uid is a full reset; wipe the baseline accumulator.
    if (!testUid) {
      ctx.baselineStore.resetActiveRun()
    }
    ctx.broadcastToClients(
      JSON.stringify({
        scope: WS_SCOPE.clearExecutionData,
        data: { uid: testUid }
      })
    )
    return true
  }
  if (parsed.scope === 'config' && parsed.data?.configFile) {
    const configFile = String(parsed.data.configFile)
    ctx.testRunner.registerConfigFile(configFile)
    log.info(`Registered config file for reruns: ${configFile}`)
    return true
  }
  // Screencast: store the absolute videoPath in the registry (backend-only),
  // then forward the sessionId plus recording timing (startTime/duration) so
  // the UI can fetch via /api/video/:sessionId and map actions onto the video.
  if (parsed.scope === 'screencast' && parsed.data?.sessionId) {
    const sessionId = String(parsed.data.sessionId)
    const videoPath =
      typeof parsed.data.videoPath === 'string'
        ? parsed.data.videoPath
        : undefined
    if (videoPath) {
      ctx.videoRegistry.set(sessionId, videoPath)
      log.info(`Screencast registered for session ${sessionId}: ${videoPath}`)
    }
    const startTime =
      typeof parsed.data.startTime === 'number'
        ? parsed.data.startTime
        : undefined
    const duration =
      typeof parsed.data.duration === 'number'
        ? parsed.data.duration
        : undefined
    ctx.broadcastToClients(
      JSON.stringify({
        scope: 'screencast',
        data: { sessionId, startTime, duration }
      })
    )
    return true
  }
  return false
}

/**
 * Build the worker WS `message` listener for {@link WS_PATHS.worker}. Handles
 * three control scopes inline (`clearCommands`, `config`, `screencast`) and
 * forwards everything else verbatim to the dashboard clients.
 */
export function createWorkerMessageHandler(
  ctx: WorkerMessageContext
): (message: Buffer) => void {
  return (message: Buffer) => {
    // Use `debug` — at `info` this feeds the worker's stream capture loop.
    const count = ctx.clientCount()
    log.debug(
      `received ${message.length} byte message from worker to ${count} client${count > 1 ? 's' : ''}`
    )
    try {
      const parsed = JSON.parse(message.toString())
      if (tryHandleControlMessage(parsed, ctx)) {
        return
      }
      // Tee the event into the baseline accumulator for time-window
      // partitioning at preserve time. After special-case handling so we
      // don't accumulate control frames (clearCommands, screencast).
      ctx.baselineStore.recordEvent(parsed.scope, parsed.data)
    } catch {
      // Not JSON or parsing failed — forward as-is.
    }
    ctx.broadcastToClients(message.toString())
  }
}
