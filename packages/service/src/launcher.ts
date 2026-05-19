import path from 'node:path'
import http from 'node:http'
import { remote } from 'webdriverio'
import { start } from '@wdio/devtools-backend'
import logger from '@wdio/logger'
import { DEFAULT_LAUNCH_CAPS } from './constants.js'
import type { ServiceOptions, ExtendedCapabilities } from './types.js'

const log = logger('@wdio/devtools-service:Launcher')

/**
 * When the UI re-runs a test, the backend spawns a fresh WDIO process with
 * DEVTOOLS_APP_REUSE=1. The original CLI process is typically still alive
 * and its port-binding services (static-server, mock-server, etc.) still
 * own their ports. The rerun process loads the same config and those
 * services' `onPrepare` call `app.listen(port)` again — EADDRINUSE.
 *
 * WDIO runs service onPrepare hooks in parallel (Promise.all in
 * runServiceHook), so we can't mutate `config.services` to splice out the
 * conflicting service from our own onPrepare — by the time we run it's
 * already racing. Instead, patch http.Server.prototype.listen at module
 * load time (which runs before any onPrepare fires) and quietly swallow
 * EADDRINUSE specifically when we know we're a rerun. The demo app is
 * still served by the original process, so the test still works — we
 * just stop the noisy "service failed in onPrepare hook" log.
 *
 * Scope is narrow: only DEVTOOLS_APP_REUSE=1, only EADDRINUSE, only the
 * one offending server (we revert the per-instance override once the
 * error has been consumed so future emits behave normally).
 */
if (process.env.DEVTOOLS_APP_REUSE === '1') {
  const originalListen = http.Server.prototype.listen
  http.Server.prototype.listen = function patchedListen(
    this: http.Server,
    ...args: unknown[]
  ): http.Server {
    const originalEmit = this.emit.bind(this)
    this.emit = (event: string, ...emitArgs: unknown[]) => {
      if (
        event === 'error' &&
        (emitArgs[0] as { code?: string })?.code === 'EADDRINUSE'
      ) {
        log.warn(
          `Suppressed EADDRINUSE on rerun (port ${String(args[0])}); reusing existing server from the originating CLI process`
        )
        this.emit = originalEmit
        process.nextTick(() => originalEmit('listening'))
        return true
      }
      return originalEmit(event, ...emitArgs)
    }
    return originalListen.apply(this, args as never) as http.Server
  }
}

/**
 * Find the config file the user invoked WDIO/Nightwatch with by scanning
 * the launcher's argv. Handles `wdio run <config>` positional form and the
 * `--config <path>` (Nightwatch) flagged form. Returns an absolute path.
 *
 * Detection lives in the launcher (not the worker) because workers are
 * forked with their own argv and don't see the original config arg.
 */
function detectInvocationConfigPath(): string | undefined {
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
 * Collect any `--spec` / `-s` paths the user passed at the CLI. Used to
 * scope the UI's "Run All" button to the spec(s) that were originally
 * invoked, rather than letting WDIO walk every file matched by
 * `config.specs`. WDIO accepts both repeated `--spec foo --spec bar`
 * and comma-separated `--spec foo,bar` forms.
 */
function detectInvocationSpecs(): string[] {
  const argv = process.argv
  const out: string[] = []
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--spec' || argv[i] === '-s') {
      const raw = argv[i + 1]
      if (!raw) {
        continue
      }
      for (const part of raw.split(',')) {
        const trimmed = part.trim()
        if (!trimmed) {
          continue
        }
        out.push(
          path.isAbsolute(trimmed)
            ? trimmed
            : path.resolve(process.cwd(), trimmed)
        )
      }
    }
  }
  return out
}

export class DevToolsAppLauncher {
  #options: ServiceOptions
  #browser?: WebdriverIO.Browser

  constructor(options: ServiceOptions) {
    this.#options = options
  }

  async onPrepare(_: never, caps: ExtendedCapabilities[]) {
    try {
      // Capture the config the user invoked with so the rerun resolver in
      // the backend can target the same file (handles non-standard names
      // like `wdio.BUILD.conf.ts` that the default-name search won't find).
      // Set in process.env so:
      //   - in-process backend reads it dynamically in `#resolveConfigPath`
      //   - the WDIO worker inherits it and forwards it to the backend over
      //     the /worker WS for the reused-app case.
      const detectedConfig = detectInvocationConfigPath()
      if (detectedConfig && !process.env.DEVTOOLS_WDIO_CONFIG) {
        process.env.DEVTOOLS_WDIO_CONFIG = detectedConfig
        log.info(`Detected config for reruns: ${detectedConfig}`)
      }

      // Remember the spec(s) the user invoked with so the UI's "Run All"
      // button reruns the same scope rather than expanding to every spec
      // matched by `config.specs`. The backend reads this dynamically when
      // building rerun filters for runAll payloads.
      if (!process.env.DEVTOOLS_WDIO_INITIAL_SPECS) {
        const detectedSpecs = detectInvocationSpecs()
        if (detectedSpecs.length) {
          process.env.DEVTOOLS_WDIO_INITIAL_SPECS = detectedSpecs.join(
            path.delimiter
          )
          log.info(
            `Detected initial specs for Run All: ${detectedSpecs.join(', ')}`
          )
        }
      }

      const reusePort = process.env.DEVTOOLS_APP_PORT
      const reuseHost =
        process.env.DEVTOOLS_APP_HOST || this.#options.hostname || 'localhost'
      if (process.env.DEVTOOLS_APP_REUSE === '1' && reusePort) {
        log.info(
          `Reusing existing DevTools app at http://${reuseHost}:${reusePort}`
        )
        this.#updateCapabilities(caps, {
          port: Number(reusePort),
          hostname: reuseHost
        })
        return
      }
      const { port } = await start({
        port: this.#options.port,
        hostname: this.#options.hostname
      })

      if (!port) {
        return console.log(`Failed to start server on port ${port}`)
      }

      this.#updateCapabilities(caps, {
        port,
        hostname: this.#options.hostname || 'localhost'
      })
      this.#browser = await remote({
        automationProtocol: 'devtools',
        capabilities: {
          ...DEFAULT_LAUNCH_CAPS,
          ...this.#options.devtoolsCapabilities
        }
      })
      await this.#browser.url(`http://localhost:${port}`)
    } catch (err) {
      console.error(err)
    }
  }

  async onComplete() {
    if (this.#browser) {
      logger.setLevel('devtools', 'warn')
      log.info('Please close the browser window to finish...')
      while (true) {
        try {
          await this.#browser.getTitle()
          await new Promise((res) => setTimeout(res, 1000))
        } catch {
          log.info('Browser window closed, stopping DevTools app')
          break
        }
      }
      try {
        await this.#browser.deleteSession()
      } catch (err: any) {
        log.warn('Session already closed or could not be deleted:', err.message)
      }
    }
  }

  #updateCapabilities(
    caps: ExtendedCapabilities[],
    devtoolsApp: { port: number; hostname?: string }
  ) {
    /**
     * we don't support multiremote yet
     */
    if (!Array.isArray(caps)) {
      return
    }

    for (const cap of caps) {
      cap['wdio:devtoolsOptions'] = {
        port: devtoolsApp.port,
        hostname: devtoolsApp.hostname || 'localhost'
      }
    }
  }
}
