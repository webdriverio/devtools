/**
 * Run-level lifecycle helpers for the Nightwatch plugin — reuse-mode setup,
 * DevTools-browser spawning, end-of-run summary, and the post-run "wait for
 * browser close" loop.
 *
 * Extracted from `index.ts` to keep that file under the file-size cap.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import logger from '@wdio/logger'
import { remote } from 'webdriverio'
import { errorMessage } from '@wdio/devtools-core'
import { REUSE_ENV } from '@wdio/devtools-shared'
import { start, stop } from '@wdio/devtools-backend'

import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { TestManager } from './helpers/testManager.js'
import type {
  DevToolsMode,
  NightwatchBrowser,
  NightwatchCurrentTest
} from './types.js'
import { TIMING, PLUGIN_GLOBAL_KEY } from './constants.js'
import { findFreePort, resolveNightwatchConfig } from './helpers/utils.js'

const log = logger('@wdio/nightwatch-devtools:run-lifecycle')

export interface RunLifecycleCtx {
  options: { hostname: string; port: number; mode?: DevToolsMode }
  readonly testReporter: TestReporter | undefined
  readonly suiteManager: SuiteManager | undefined
  readonly testManager: TestManager
  readonly sessionCapturer: SessionCapturer | undefined
  devtoolsBrowser: WebdriverIO.Browser | undefined
  userDataDir: string | undefined
  passCount: number
  failCount: number
  skipCount: number
  clearExecutionData(): void
}

export function handleReuseMode(ctx: RunLifecycleCtx): void {
  ctx.options.hostname = process.env[REUSE_ENV.HOST]!
  ctx.options.port = Number(process.env[REUSE_ENV.PORT])
  log.info(
    `♻  Reusing DevTools backend at ${ctx.options.hostname}:${ctx.options.port}`
  )
  // Clear execution data from the previous run when rerunning so test-name
  // caches and suites are fresh for the new run.
  if (ctx.testReporter) {
    ctx.clearExecutionData()
    ctx.passCount = 0
    ctx.failCount = 0
    ctx.skipCount = 0
    log.info('Cleared execution data for rerun')
  }
}

export interface PluginBeforeCtx extends RunLifecycleCtx {
  setConfigPath(v: string | undefined): void
  openDevtoolsBrowserAt(url: string): Promise<void>
  handleReuse(): void
  // The plugin instance to assign to the global slot for cucumber hooks.
  plugin: unknown
}

export async function runPluginBefore(ctx: PluginBeforeCtx): Promise<void> {
  // When relaunched by the DevTools UI rerun button the backend is already
  // running — skip startup and just connect the WebSocket worker.
  const isReuse =
    process.env[REUSE_ENV.REUSE] === '1' &&
    !!process.env[REUSE_ENV.HOST] &&
    !!process.env[REUSE_ENV.PORT]
  if (isReuse) {
    ctx.handleReuse()
  }
  const configPath = resolveNightwatchConfig()
  ctx.setConfigPath(configPath)
  if (configPath) {
    log.info(`✓ Config: ${configPath}`)
  } else {
    log.warn(
      'Could not find nightwatch config — test rerun will be unavailable'
    )
  }
  if (isReuse) {
    ;(globalThis as Record<string, unknown>)[PLUGIN_GLOBAL_KEY] = ctx.plugin
    return
  }
  try {
    // Trace mode: skip backend port-bind and UI entirely — matches the WDIO
    // launcher gate. SessionCapturer construction in session-init also gates
    // its WS init off in trace mode.
    if (ctx.options.mode === 'trace') {
      log.info('Trace mode — skipping backend port-bind and UI window')
    } else {
      ctx.options.port = await findFreePort(
        ctx.options.port,
        ctx.options.hostname
      )
      log.info('🚀 Starting DevTools backend...')
      const { port } = await start(ctx.options)
      ctx.options.port = port
      const url = `http://${ctx.options.hostname}:${ctx.options.port}`
      log.info(`✓ Backend started on port ${ctx.options.port}`)
      log.info(`  DevTools UI: ${url}`)
      await ctx.openDevtoolsBrowserAt(url)
      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.UI_CONNECTION_WAIT)
      )
    }
    ;(globalThis as Record<string, unknown>)[PLUGIN_GLOBAL_KEY] = ctx.plugin
  } catch (err) {
    log.error(`Failed to start backend: ${errorMessage(err)}`)
    throw err
  }
}

export async function openDevtoolsBrowser(
  ctx: RunLifecycleCtx,
  url: string
): Promise<void> {
  try {
    // Unique user data directory per instance to prevent conflicts.
    ctx.userDataDir = path.join(
      os.tmpdir(),
      `nightwatch-devtools-${ctx.options.port}-${Date.now()}`
    )
    if (!fs.existsSync(ctx.userDataDir)) {
      fs.mkdirSync(ctx.userDataDir, { recursive: true })
    }
    ctx.devtoolsBrowser = await remote({
      logLevel: 'info',
      automationProtocol: 'devtools',
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: [
            '--window-size=1600,1200',
            `--user-data-dir=${ctx.userDataDir}`,
            '--no-first-run',
            '--no-default-browser-check'
          ]
        }
      }
    })
    await ctx.devtoolsBrowser.url(url)
  } catch (err) {
    log.error(`Failed to open DevTools UI: ${errorMessage(err)}`)
    log.info(`Please manually open: ${url}`)
  }
}

export async function finalizeAllSuites(
  ctx: RunLifecycleCtx,
  browser?: NightwatchBrowser
): Promise<void> {
  const currentTest = browser?.currentTest as NightwatchCurrentTest | undefined
  const testcases = currentTest?.results?.testcases ?? {}
  for (const [, suite] of (
    ctx.suiteManager?.getAllSuites() ?? new Map()
  ).entries()) {
    ctx.testManager.finalizeSuiteTests(suite, testcases)
    await new Promise((resolve) =>
      setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
    )
    ctx.suiteManager?.finalizeSuite(suite)
  }
  await new Promise((resolve) =>
    setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
  )
}

export function logRunSummary(ctx: RunLifecycleCtx): void {
  const summary = [
    ctx.passCount > 0 ? `${ctx.passCount} passed` : null,
    ctx.failCount > 0 ? `${ctx.failCount} failed` : null,
    ctx.skipCount > 0 ? `${ctx.skipCount} skipped` : null
  ]
    .filter(Boolean)
    .join('  ')
  log.info(`${ctx.failCount > 0 ? '❌' : '✅'} Tests complete!  ${summary}`)
  log.info(`   DevTools UI: http://${ctx.options.hostname}:${ctx.options.port}`)
}

export async function waitForDevtoolsBrowserClose(
  ctx: RunLifecycleCtx
): Promise<void> {
  if (!ctx.devtoolsBrowser) {
    return
  }
  ;(logger as { setLevel: (ns: string, lvl: string) => void }).setLevel(
    'devtools',
    'warn'
  )
  let exitBySignal = false
  const signalHandler = () => {
    exitBySignal = true
    log.info('\n✓ Exiting... Browser window will remain open')
    process.exit(0)
  }
  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)
  while (true) {
    try {
      await ctx.devtoolsBrowser.getTitle()
      await new Promise((res) => setTimeout(res, TIMING.BROWSER_POLL_INTERVAL))
    } catch {
      if (!exitBySignal) {
        log.info('Browser window closed, stopping DevTools app')
        break
      }
    }
  }
  if (exitBySignal) {
    return
  }
  process.removeListener('SIGINT', signalHandler)
  process.removeListener('SIGTERM', signalHandler)
  ;(logger as { setLevel: (ns: string, lvl: string) => void }).setLevel(
    'devtools',
    'info'
  )
  try {
    await ctx.devtoolsBrowser.deleteSession()
  } catch {
    /* session already closed */
  }
  await stop()
  process.exit(0)
}
