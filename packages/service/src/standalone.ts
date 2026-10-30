import path from 'node:path'
import type { Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'
import { RUNNER_ENV } from '@wdio/devtools-shared'
import DevToolsHookService from './index.js'
import type { SessionCapturer } from './session.js'
import { TraceType } from './types.js'
import { configPathFromArgv } from './invocation-args.js'

/**
 * Resolve the WDIO config path from argv or `DEVTOOLS_WDIO_CONFIG`. The
 * service uses this to send a `config` upstream message so the dashboard's
 * rerun button knows which config to relaunch with.
 */
export function detectInvocationConfigPath(): string | undefined {
  const envPath = process.env[RUNNER_ENV.WDIO_CONFIG]
  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath)
  }
  return configPathFromArgv()
}

/** Sent on the capturer that has a socket: `beforeSession` sees a placeholder
 *  without one, where the frame was dropped and no dashboard learned the file. */
export function publishConfigFile(
  capturer: Pick<SessionCapturer, 'sendUpstream'>
): void {
  const detectedConfig = detectInvocationConfigPath()
  if (detectedConfig) {
    capturer.sendUpstream('config', { configFile: detectedConfig })
  }
}

/**
 * Setup WebdriverIO Devtools hook for standalone instances — wires the
 * service into `opts.beforeCommand`/`afterCommand` callbacks so a non-WDIO-
 * runner consumer (e.g. a Node script using `remote()` directly) still gets
 * command capture and screencast recording.
 */
export function setupForDevtools(
  opts: Options.WebdriverIO
): Options.WebdriverIO {
  let browserCaptured = false
  const service = new DevToolsHookService()
  service.captureType = TraceType.Standalone

  // In v9, the `opts` object itself contains the capabilities.
  service.beforeSession(opts, opts as Capabilities.W3CCapabilities)

  opts.beforeCommand = Array.isArray(opts.beforeCommand)
    ? opts.beforeCommand
    : opts.beforeCommand
      ? [opts.beforeCommand]
      : []
  opts.beforeCommand.push(async function captureBrowserInstance(
    this: WebdriverIO.Browser,
    command: keyof WebDriverCommands
  ) {
    if (!browserCaptured) {
      browserCaptured = true
      service.before(
        this.capabilities as Capabilities.W3CCapabilities,
        [],
        this
      )
    }

    // Capture trace on `deleteSession` — afterCommand fires after the
    // session is gone, so do it here before the WS to the browser closes.
    if (command === 'deleteSession') {
      await service.after()
    }
  }, service.beforeCommand.bind(service))

  opts.afterCommand = Array.isArray(opts.afterCommand)
    ? opts.afterCommand
    : opts.afterCommand
      ? [opts.afterCommand]
      : []
  opts.afterCommand.push(service.afterCommand.bind(service))

  return opts
}
