/**
 * Single internals "bag" the Selenium plugin exposes to its lifecycle modules.
 *
 * Each lifecycle module declares its own narrow `Ctx` interface; the plugin
 * builds ONE `PluginInternals` object that structurally satisfies all of
 * them. Keeps the plugin file compact while letting each lifecycle module
 * narrow its dependencies.
 */

import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { TestManager } from './helpers/testManager.js'
import type { ScreencastRecorder } from './screencast.js'
import type { ScreencastOptions, SeleniumDriverLike } from './types.js'
import type { RetryTracker } from '@wdio/devtools-core'
import type { PendingTestAction, PendingScenario } from './test-management.js'

export interface PluginInternals {
  // Config
  readonly options: {
    hostname: string
    port: number
    openUi: boolean
    captureScreenshots: boolean
    rerunCommand?: string
  }
  readonly screencastOptions: ScreencastOptions
  readonly runner: string
  readonly rerunTemplate: string | undefined
  readonly launchCommand: string | undefined
  readonly isReuse: boolean
  readonly finalized: boolean
  readonly retryTracker: RetryTracker

  // Mutable runtime instances
  driver: SeleniumDriverLike | undefined
  sessionCapturer: SessionCapturer | undefined
  testReporter: TestReporter | undefined
  suiteManager: SuiteManager | undefined
  testManager: TestManager | undefined
  screencast: ScreencastRecorder | undefined
  sessionId: string | undefined
  scriptInjected: boolean
  testFilePath: string | undefined
  keepAliveTimer: ReturnType<typeof setInterval> | undefined

  // Test management buffers
  pendingTestActions: PendingTestAction[]
  pendingScenario: PendingScenario | null

  // Plugin-side delegates
  setFinalized(v: boolean): void
  setScriptInjected(v: boolean): void
  ensureBackendStarted(): Promise<void>
  flushPendingTestActions(): void
  resetRetryTracker(): void
  clearKeepAlive(): void
}
