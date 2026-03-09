/**
 * Cucumber support file — injected into @cucumber/cucumber's `require` list by
 * the DevTools plugin at runtime.  Because Cucumber loads this file itself
 * (via its own require machinery), we are guaranteed to be using the SAME
 * supportCodeLibraryBuilder singleton that the user's step definitions use.
 *
 * Hook ordering:
 *   Before {order:1000} → runs AFTER Nightwatch's browser-launch hook (order:0)
 *   After  {order:1000} → runs BEFORE Nightwatch's browser-quit hook  (order:0)
 *                          (Cucumber After: higher order executes first)
 *
 * NOTE: This is intentionally a .cts file so TypeScript compiles it as CJS
 * (required by Cucumber's loader when the surrounding package is ESM).
 */

interface CucumberApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Before(options: any, fn: (this: any, arg: any) => Promise<void>): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  After(options: any, fn: (this: any, arg: any) => Promise<void>): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BeforeStep(options: any, fn: (this: any, arg: any) => Promise<void>): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AfterStep(options: any, fn: (this: any, arg: any) => Promise<void>): void
}

// @cucumber/cucumber is NOT a direct dependency of this package.
// At runtime this require() is resolved from the user's project (via Cucumber's
// own loader), so it always gets the same singleton the step definitions use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Before, After, BeforeStep, AfterStep } = require('@cucumber/cucumber') as CucumberApi

// The plugin instance is stored here by NightwatchDevToolsPlugin.before()
interface CucumberPluginBridge {
  cucumberBefore(browser: unknown, pickle: unknown): Promise<void>
  cucumberAfter(browser: unknown, result: unknown, pickle: unknown): Promise<void>
  cucumberBeforeStep(browser: unknown, pickleStep: unknown, pickle: unknown): Promise<void>
  cucumberAfterStep(browser: unknown, result: unknown, pickleStep: unknown, pickle: unknown): Promise<void>
}

Before({ order: 1000 }, async function (this: any, { pickle }: any) {
  const plugin = (globalThis as any).__nightwatchDevtoolsPlugin as CucumberPluginBridge | undefined
  if (this.browser && plugin) {
    await plugin.cucumberBefore(this.browser, pickle)
  }
})

After({ order: 1000 }, async function (this: any, { result, pickle }: any) {
  const plugin = (globalThis as any).__nightwatchDevtoolsPlugin as CucumberPluginBridge | undefined
  if (this.browser && plugin) {
    await plugin.cucumberAfter(this.browser, result, pickle)
  }
})

BeforeStep({ order: 1000 }, async function (this: any, { pickleStep, pickle }: any) {
  const plugin = (globalThis as any).__nightwatchDevtoolsPlugin as CucumberPluginBridge | undefined
  if (this.browser && plugin) {
    await plugin.cucumberBeforeStep(this.browser, pickleStep, pickle)
  }
})

AfterStep({ order: 1000 }, async function (this: any, { result, pickleStep, pickle }: any) {
  const plugin = (globalThis as any).__nightwatchDevtoolsPlugin as CucumberPluginBridge | undefined
  if (this.browser && plugin) {
    await plugin.cucumberAfterStep(this.browser, result, pickleStep, pickle)
  }
})
