import { spawn } from 'node:child_process'

/**
 * Minimal shape the process hooks need from the selenium plugin. Keeps this
 * helper from importing the plugin class (which would create a cycle).
 */
export interface ProcessHookPlugin {
  isReuse: boolean
  options: { port: number }
  sessionCapturer?: { closeWebSocket: () => Promise<void>; cleanup: () => void }
  clearKeepAlive: () => void
  onSessionEnd: () => Promise<void>
}

/**
 * Close the worker WS, restore captures, pkill the detached Chrome dashboard
 * (skip in reuse mode — only the parent owns it), and `process.exit(code)`.
 * Exported so the plugin can also call this when the dashboard disconnects
 * post-tests (see `setClientDisconnectedHandler`).
 */
export async function gracefulShutdown(
  plugin: ProcessHookPlugin,
  code: number
): Promise<void> {
  try {
    plugin.clearKeepAlive()
    await plugin.sessionCapturer?.closeWebSocket()
    plugin.sessionCapturer?.cleanup()
    if (!plugin.isReuse) {
      try {
        spawn(
          '/usr/bin/pkill',
          ['-f', `selenium-devtools-ui-${plugin.options.port}-`],
          { stdio: 'ignore' }
        )
      } catch {
        /* pkill missing — accept stale Chrome */
      }
    }
  } catch {
    /* best-effort */
  }
  process.exit(code)
}

/**
 * Wire up process-lifetime hooks for the selenium plugin:
 *  - `exit`/`beforeExit`: trigger idempotent session end + (on beforeExit)
 *    close the worker WS so the event loop can drain.
 *  - `SIGINT`/`SIGTERM`: graceful shutdown — close WS, cleanup capture, and
 *    in non-reuse mode pkill the detached Chrome dashboard for THIS run.
 */
export function registerProcessHooks(plugin: ProcessHookPlugin): void {
  process.on('exit', () => {
    void plugin.onSessionEnd()
  })
  process.on('beforeExit', () => {
    // onSessionEnd is async (awaits onDriverEnd before finalizing the session
    // test/suite), so wait for it to flush its final suites update before
    // closing the worker WebSocket.
    void plugin
      .onSessionEnd()
      .finally(() => plugin.sessionCapturer?.closeWebSocket())
  })
  process.on('SIGINT', () => {
    void gracefulShutdown(plugin, 130)
  })
  process.on('SIGTERM', () => {
    void gracefulShutdown(plugin, 143)
  })
}
