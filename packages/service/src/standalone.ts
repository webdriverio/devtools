import path from 'node:path'
import type { Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'
import DevToolsHookService from './index.js'
import { TraceType } from './types.js'

/**
 * Resolve the WDIO config path from argv or `DEVTOOLS_WDIO_CONFIG`. The
 * service uses this to send a `config` upstream message so the dashboard's
 * rerun button knows which config to relaunch with.
 */
export function detectInvocationConfigPath(): string | undefined {
  const envPath = process.env.DEVTOOLS_WDIO_CONFIG
  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(process.cwd(), envPath)
  }
  const argv = process.argv
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--config' || argv[i] === '-c') {
      const next = argv[i + 1]
      if (next && /\.(conf|config)\.(ts|js|cjs|mjs)$/i.test(next)) {
        return path.isAbsolute(next) ? next : path.resolve(process.cwd(), next)
      }
    }
  }
  const positional = argv.find((a) => /\.conf\.(ts|js|cjs|mjs)$/i.test(a))
  if (!positional) {
    return undefined
  }
  return path.isAbsolute(positional)
    ? positional
    : path.resolve(process.cwd(), positional)
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
