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
import { stop } from '@wdio/devtools-backend'

import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { TestManager } from './helpers/testManager.js'
import type { NightwatchBrowser } from './types.js'
import { TIMING } from './constants.js'

const log = logger('@wdio/nightwatch-devtools:run-lifecycle')

export interface RunLifecycleCtx {
  options: { hostname: string; port: number }
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
  const currentTest: any = (browser as { currentTest?: unknown })?.currentTest
  const testcases = currentTest?.results?.testcases || {}
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
