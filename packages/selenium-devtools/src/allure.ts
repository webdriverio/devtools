// Selenium Allure binding: resolve the optional `allure-js-commons` into a core
// `AllureAttachSink`. The capture/attach orchestration + content-type convention
// live in `@wdio/devtools-core`; this file owns only the runtime-agnostic
// optional-dependency dance and `allure-js-commons`' functional `attachment()`.

import type { AllureAttachSink } from '@wdio/devtools-core'

/** The one `allure-js-commons` function we use. Typed locally so the optional
 *  peer dependency never becomes a build-time type dependency. */
interface AllureCommonsModule {
  attachment(
    name: string,
    content: Buffer | string,
    contentType: string
  ): void | Promise<void>
}

// undefined = unresolved; null = runtime present but allure-js-commons absent.
let cachedSink: AllureAttachSink | null | undefined

// A non-literal specifier keeps TypeScript and tsup/esbuild from resolving this
// optional peer dependency at build time — `import()` of a variable is typed
// `any` and left as a runtime import that no-ops (caught below) when absent.
const ALLURE_COMMONS_SPECIFIER = 'allure-js-commons'

/**
 * Resolve the Allure attach sink, or undefined when Allure isn't active. Only
 * binds a sink when a runner adapter has installed `globalThis.allureTestRuntime`:
 * without it `allure-js-commons`' `attachment()` is a noop that logs a warning on
 * every call, so a plain (non-Allure) run would be spammed. The resolved sink is
 * memoized once found; while the runtime is absent this returns undefined
 * WITHOUT caching, so a later call after Allure activates can still resolve. The
 * sink must be called from within a per-test hook so Allure attaches to the
 * right test.
 */
export async function getAllureSink(): Promise<AllureAttachSink | undefined> {
  if (cachedSink !== undefined) {
    return cachedSink ?? undefined
  }
  if (!(globalThis as { allureTestRuntime?: unknown }).allureTestRuntime) {
    return undefined
  }
  try {
    const mod = await import(/* @vite-ignore */ ALLURE_COMMONS_SPECIFIER)
    const commons = (
      typeof mod.attachment === 'function' ? mod : mod.default
    ) as AllureCommonsModule | undefined
    cachedSink =
      commons && typeof commons.attachment === 'function'
        ? (name, content, type) => commons.attachment(name, content, type)
        : null
  } catch {
    // Optional peer dependency not installed — attaching is a no-op.
    cachedSink = null
  }
  return cachedSink ?? undefined
}

/** Reset the memoized sink — test seam only. */
export function resetAllureSinkCache(): void {
  cachedSink = undefined
}
