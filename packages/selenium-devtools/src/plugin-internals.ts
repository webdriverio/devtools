/**
 * Single internals "bag" the Selenium plugin exposes to its lifecycle modules.
 *
 * Each lifecycle module declares its own narrow `Ctx` interface; the plugin
 * builds ONE `PluginInternals` object that structurally satisfies all of
 * them. Keeps the plugin file compact while letting each lifecycle module
 * narrow its dependencies.
 */

import type { SessionLifecycleCtx } from './session-lifecycle.js'
import type { TestManagementCtx } from './test-management.js'
import type { OnCommandCtx } from './helpers/commandPostActions.js'
import type { TestReporter } from './reporter.js'
import type { SessionCapturer } from './session.js'
import type { TestManager } from './helpers/testManager.js'
import type { SeleniumDriverLike } from './types.js'

export interface PluginInternals
  extends SessionLifecycleCtx, TestManagementCtx, OnCommandCtx {
  // Redeclared because the bases disagree on these, which `extends` rejects.
  readonly options: SessionLifecycleCtx['options']
  driver: SeleniumDriverLike | undefined
  sessionCapturer: SessionCapturer | undefined
  testReporter: TestReporter | undefined
  testManager: TestManager | undefined
}
