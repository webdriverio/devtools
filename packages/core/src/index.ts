// Framework-agnostic capture/reporter logic shared by @wdio/devtools-*
// adapters. See ARCHITECTURE.md §2 and CLAUDE.md §2.2.

// `action-mapping` and `console` moved to `shared` — the trace transforms need
// them and must not depend on adapter logic. Re-exported here, and only these
// names, so adapters keep importing them from `core` unchanged.
export {
  ASSERT_ACTION_CLASS,
  FILL_METHODS,
  formatActionTitle,
  mapAssertCommand,
  mapCommandToAction,
  type TraceAction
} from '@wdio/devtools-shared'
export * from './action-snapshot.js'
export * from './artifact-naming.js'
export * from './artifacts-manifest.js'
export * from './allure-artifacts.js'
export * from './attempt-tracker.js'
export * from './screenshot-artifact.js'
export * from './video-slice.js'
export * from './with-timeout.js'
export * from './assert-patcher.js'
export * from './element-snapshot.js'
export * from './element-scripts.js'
export * from './element-types.js'
// The trace transforms moved to `@wdio/devtools-trace` so the backend can
// reach them without importing core. Re-exported per module rather than as one
// `export *` so core's surface stays exactly what it was — `trace-transcript`
// is deliberately absent here, as it was before the move.
export * from '@wdio/devtools-trace/sha1'
export * from '@wdio/devtools-trace/trace-action-events'
export * from '@wdio/devtools-trace/trace-console'
export * from '@wdio/devtools-trace/trace-hierarchy'
export * from '@wdio/devtools-trace/trace-exporter'
export * from './trace-finalizer.js'
export * from '@wdio/devtools-trace/trace-frame-snapshots'
export * from '@wdio/devtools-trace/trace-retention'
export * from '@wdio/devtools-trace/trace-sources'
export * from '@wdio/devtools-trace/trace-har'
export * from '@wdio/devtools-trace/trace-mutations'
export * from '@wdio/devtools-trace/trace-snapshots'
export * from '@wdio/devtools-trace/trace-zip-writer'
export * from './bidi.js'
export * from './bidi-preload.js'
export {
  ANSI_REGEX,
  CONSOLE_METHODS,
  ERROR_INDICATORS,
  LOG_LEVEL_PATTERNS,
  LOG_SOURCES,
  SPINNER_RE,
  chromeLogLevelToLogLevel,
  createConsoleLogEntry,
  detectLogLevel,
  isInternalStreamLine,
  mapChromeBrowserLogs,
  stripAnsi,
  type LogSource
} from '@wdio/devtools-shared'
export * from './uid.js'
export * from './net.js'
export * from './request-type.js'
export * from './stack.js'
export * from './terminal-throttle.js'
export * from './error.js'
export * from './finalize-screencast.js'
export * from './input-dispatch.js'
export * from './output-dir.js'
export * from './performance-capture.js'
export * from './read-value-locators.js'
export * from './retry-tracker.js'
export * from './run-id.js'
export * from './screencast.js'
export * from '@wdio/devtools-trace/screencast-trace'
export * from './script-loader.js'
export * from './session-capturer.js'
export * from './spec-trace-helpers.js'
export * from './suite-helpers.js'
export * from './test-discovery.js'
export * from './test-reporter.js'
export * from './video-encoder.js'
