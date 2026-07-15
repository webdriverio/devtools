// WDIO Allure glue: attach retained trace/video artifacts to the current Allure
// test so a failed run's trace travels with the report. Isolated here so
// index.ts stays free of the optional-dependency dance and the content-type
// convention lives in one place.

import fs from 'node:fs/promises'
import { basename } from 'node:path'
import logger from '@wdio/logger'
import type { TraceArtifact } from '@wdio/devtools-core'

const log = logger('@wdio/devtools-service')

// Attach the trace as a plain zip download — the viewer stays the user's choice
// (our `show-trace`, or any compatible viewer), rather than routing them into a
// third-party viewer Allure would open for a trace-specific content type. Video
// uses video/webm so Allure renders it inline.
const TRACE_CONTENT_TYPE = 'application/zip'
const VIDEO_CONTENT_TYPE = 'video/webm'
const SCREENSHOT_CONTENT_TYPE = 'image/png'

const CONTENT_TYPE_BY_KIND: Record<TraceArtifact['kind'], string> = {
  trace: TRACE_CONTENT_TYPE,
  video: VIDEO_CONTENT_TYPE,
  screenshot: SCREENSHOT_CONTENT_TYPE
}

/** The one @wdio/allure-reporter method we use. Typed locally so the optional
 *  peer dependency never becomes a build-time type dependency. */
interface AllureReporterModule {
  addAttachment(name: string, content: Buffer, type: string): void
}

// undefined = not yet probed; null = probed and unavailable.
let cachedReporter: AllureReporterModule | null | undefined

// A non-literal specifier keeps TypeScript and the bundler from resolving this
// optional peer dependency at build time — `import()` of a variable is typed
// `any` and left as a runtime import that no-ops (caught below) when absent.
const ALLURE_REPORTER_SPECIFIER = '@wdio/allure-reporter'

async function loadAllureReporter(): Promise<AllureReporterModule | null> {
  if (cachedReporter !== undefined) {
    return cachedReporter
  }
  try {
    const mod = await import(/* @vite-ignore */ ALLURE_REPORTER_SPECIFIER)
    const candidate = (
      typeof mod.addAttachment === 'function' ? mod : mod.default
    ) as AllureReporterModule | undefined
    cachedReporter =
      candidate && typeof candidate.addAttachment === 'function'
        ? candidate
        : null
  } catch {
    // Optional peer dependency not installed — attaching is a no-op.
    cachedReporter = null
  }
  return cachedReporter
}

/**
 * Attach one retained artifact to the current Allure test. No-op when the
 * artifact wasn't retained, has no path yet, or @wdio/allure-reporter isn't
 * installed. Must be called from within a per-test hook (afterTest) so Allure
 * associates the attachment with the right test.
 */
export async function attachArtifactToAllure(
  artifact: TraceArtifact
): Promise<void> {
  if (!artifact.retained || !artifact.path) {
    return
  }
  const reporter = await loadAllureReporter()
  if (!reporter) {
    return
  }
  try {
    // Allure attaches a single file; the ndjson-directory trace format yields a
    // directory path, which can't be attached — skip it.
    const stat = await fs.stat(artifact.path)
    if (!stat.isFile()) {
      return
    }
    const content = await fs.readFile(artifact.path)
    const type = CONTENT_TYPE_BY_KIND[artifact.kind]
    reporter.addAttachment(basename(artifact.path), content, type)
  } catch (err) {
    // A missing/unreadable artifact must never reject the test hook.
    log.warn(`Allure attach skipped for ${artifact.path}: ${String(err)}`)
  }
}

/** Reset the memoized reporter — test seam only. */
export function resetAllureReporterCache(): void {
  cachedReporter = undefined
}
