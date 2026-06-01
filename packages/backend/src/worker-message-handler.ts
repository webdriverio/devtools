import logger from '@wdio/logger'
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

/**
 * Build the worker WS `message` listener for {@link WS_PATHS.worker}. Handles
 * three control scopes inline (`clearCommands`, `config`, `screencast`) and
 * forwards everything else verbatim to the dashboard clients.
 */
export function createWorkerMessageHandler(
  ctx: WorkerMessageContext
): (message: Buffer) => void {
  return (message: Buffer) => {
    // Use `debug` — at `info` level this feeds the worker's stream
    // capture and creates a backend↔capture loop.
    const count = ctx.clientCount()
    log.debug(
      `received ${message.length} byte message from worker to ${count} client${count > 1 ? 's' : ''}`
    )

    try {
      const parsed = JSON.parse(message.toString())

      if (parsed.scope === 'clearCommands') {
        const testUid = parsed.data?.testUid
        log.info(`Clearing commands for test: ${testUid || 'all'}`)
        // Mirror the dashboard's reset behavior: clearing without a uid
        // is a full reset, so wipe the baseline accumulator too.
        if (!testUid) {
          ctx.baselineStore.resetActiveRun()
        }
        ctx.broadcastToClients(
          JSON.stringify({
            scope: 'clearExecutionData',
            data: { uid: testUid }
          })
        )
        return
      }

      if (parsed.scope === 'config' && parsed.data?.configFile) {
        ctx.testRunner.registerConfigFile(parsed.data.configFile)
        log.info(
          `Registered config file for reruns: ${parsed.data.configFile}`
        )
        return
      }

      // Intercept screencast messages: store the absolute videoPath in the
      // registry (backend-only), then forward only the sessionId to the UI
      // so the UI can request the video via GET /api/video/:sessionId.
      if (parsed.scope === 'screencast' && parsed.data?.sessionId) {
        const { sessionId, videoPath } = parsed.data
        if (videoPath) {
          ctx.videoRegistry.set(sessionId, videoPath)
          log.info(`Screencast registered for session ${sessionId}: ${videoPath}`)
        }
        ctx.broadcastToClients(
          JSON.stringify({
            scope: 'screencast',
            data: { sessionId }
          })
        )
        return
      }
      // Tee the event into the baseline accumulator for time-window
      // partitioning at preserve time. Done after special-case handling
      // so we don't accumulate control frames (clearCommands, screencast).
      ctx.baselineStore.recordEvent(parsed.scope, parsed.data)
    } catch {
      // Not JSON or parsing failed, forward as-is
    }

    // Forward all other messages as-is
    ctx.broadcastToClients(message.toString())
  }
}
