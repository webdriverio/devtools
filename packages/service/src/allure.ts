// WDIO Allure binding: resolve the optional @wdio/allure-reporter into a core
// `AllureAttachSink`. The capture/attach orchestration + content-type convention
// now live in `@wdio/devtools-core`; this file owns only the WDIO-specific
// optional-dependency dance and the reporter's `addAttachment` shape.

import type { AllureAttachSink } from '@wdio/devtools-core'

/** The one @wdio/allure-reporter method we use. Typed locally so the optional
 *  peer dependency never becomes a build-time type dependency. */
interface AllureReporterModule {
  addAttachment(name: string, content: Buffer, type: string): void
}

// undefined = not yet probed; null = probed and unavailable.
let cachedSink: AllureAttachSink | null | undefined

// A non-literal specifier keeps TypeScript and the bundler from resolving this
// optional peer dependency at build time — `import()` of a variable is typed
// `any` and left as a runtime import that no-ops (caught below) when absent.
const ALLURE_REPORTER_SPECIFIER = '@wdio/allure-reporter'

/**
 * Resolve the Allure attach sink, or undefined when @wdio/allure-reporter isn't
 * installed. Memoized. The returned sink must be called from within a per-test
 * hook so Allure associates the attachment with the right test.
 */
export async function getAllureSink(): Promise<AllureAttachSink | undefined> {
  if (cachedSink !== undefined) {
    return cachedSink ?? undefined
  }
  try {
    const mod = await import(/* @vite-ignore */ ALLURE_REPORTER_SPECIFIER)
    const reporter = (
      typeof mod.addAttachment === 'function' ? mod : mod.default
    ) as AllureReporterModule | undefined
    cachedSink =
      reporter && typeof reporter.addAttachment === 'function'
        ? (name, content, type) => reporter.addAttachment(name, content, type)
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
