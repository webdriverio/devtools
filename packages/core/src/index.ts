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
export * from './sha1.js'
export * from './trace-action-events.js'
export * from './trace-console.js'
export * from './trace-hierarchy.js'
export * from './trace-exporter.js'
export * from './trace-finalizer.js'
export * from './trace-frame-snapshots.js'
export * from './trace-retention.js'
export * from './trace-sources.js'
export * from './trace-har.js'
export * from './trace-mutations.js'
export * from './trace-snapshots.js'
export * from './trace-zip-writer.js'
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
export * from './screencast-trace.js'
export * from './script-loader.js'
export * from './session-capturer.js'
export * from './spec-trace-helpers.js'
export * from './suite-helpers.js'
export * from './test-discovery.js'
export * from './test-reporter.js'
export * from './video-encoder.js'
