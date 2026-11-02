/**
 * Single internals "bag" the plugin exposes to its lifecycle modules.
 *
 * Each lifecycle module declares its own narrow `Ctx` interface; the plugin
 * builds ONE `PluginInternals` object that structurally satisfies all of
 * them. This keeps the plugin file compact (one accessor block instead of
 * four) while still letting each lifecycle module narrow its dependencies.
 */

import type { BrowserProxy } from './helpers/browserProxy.js'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { SessionInitCtx } from './session-init.js'
import type { TestLifecycleCtx } from './test-lifecycle.js'
import type { CucumberLifecycleCtx } from './cucumber-lifecycle.js'
import type { RunLifecycleCtx } from './run-lifecycle.js'

export interface PluginInternals
  extends
    SessionInitCtx,
    TestLifecycleCtx,
    CucumberLifecycleCtx,
    RunLifecycleCtx {
  // Redeclared because the bases disagree on these, which `extends` rejects.
  sessionCapturer: SessionCapturer
  testReporter: TestReporter
  testManager: TestManager
  suiteManager: SuiteManager
  browserProxy: BrowserProxy
  srcFolders: string[]
}
