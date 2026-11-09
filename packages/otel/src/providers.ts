import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor
} from '@opentelemetry/sdk-trace'
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
  type ReadableLogRecord
} from '@opentelemetry/sdk-logs'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import {
  detectResources,
  envDetector,
  resourceFromAttributes
} from '@opentelemetry/resources'
import type { Tracer } from '@opentelemetry/api'
import type { Logger } from '@opentelemetry/api-logs'

const SCOPE_NAME = '@wdio/devtools-otel'
const DEFAULT_SERVICE_NAME = 'devtools-tests'
const EXPORT_SUCCESS_CODE = 0

// A push emits the whole run synchronously and flushes once, so a bounded queue (2048 by default) silently drops the overflow.
const BATCH_LIMITS = { maxQueueSize: Number.MAX_SAFE_INTEGER }

// Events are capped per kind before they are added; the SDK's own limit of 128 per span would drop the oldest of a
// root's up to 200, so a test's first console errors vanished behind its failed requests.
export const SPAN_LIMITS = { eventCountLimit: Number.POSITIVE_INFINITY }

export function batchedProcessors(
  spanExporter: SpanExporter,
  logExporter: LogRecordExporter
): { span: BatchSpanProcessor; log: BatchLogRecordProcessor } {
  return {
    span: new BatchSpanProcessor({ exporter: spanExporter, ...BATCH_LIMITS }),
    log: new BatchLogRecordProcessor({ exporter: logExporter, ...BATCH_LIMITS })
  }
}

/**
 * The batch processors discard a failed export, so each exporter records its
 * failure for `flush` to rethrow, which is what makes the CLI exit non-zero.
 */
class FailureRecordingTraceExporter extends OTLPTraceExporter {
  constructor(private readonly failures: Error[]) {
    super()
  }

  override export(
    spans: ReadableSpan[],
    done: Parameters<OTLPTraceExporter['export']>[1]
  ): void {
    super.export(spans, (result) => {
      if (result.code !== EXPORT_SUCCESS_CODE) {
        this.failures.push(
          result.error ?? new Error('OTLP trace export failed')
        )
      }
      done(result)
    })
  }
}

class FailureRecordingLogExporter extends OTLPLogExporter {
  constructor(private readonly failures: Error[]) {
    super()
  }

  override export(
    logs: ReadableLogRecord[],
    done: Parameters<OTLPLogExporter['export']>[1]
  ): void {
    super.export(logs, (result) => {
      if (result.code !== EXPORT_SUCCESS_CODE) {
        this.failures.push(result.error ?? new Error('OTLP log export failed'))
      }
      done(result)
    })
  }
}

export interface Telemetry {
  tracer: Tracer
  logger: Logger
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export function telemetryWith(
  processors: { span: SpanProcessor; log: LogRecordProcessor },
  failures: readonly Error[]
): Telemetry {
  const resource = resourceFromAttributes({
    'service.name': DEFAULT_SERVICE_NAME
  }).merge(detectResources({ detectors: [envDetector] }))
  const tracerProvider = new TracerProvider({
    resource,
    spanLimits: SPAN_LIMITS,
    spanProcessors: [processors.span]
  })
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [processors.log]
  })
  return {
    tracer: tracerProvider.getTracer(SCOPE_NAME),
    logger: loggerProvider.getLogger(SCOPE_NAME),
    async flush() {
      await tracerProvider.forceFlush()
      await loggerProvider.forceFlush()
      const [first] = failures
      if (first) {
        throw first
      }
    },
    async shutdown() {
      await tracerProvider.shutdown()
      await loggerProvider.shutdown()
    }
  }
}

export function createTelemetry(options: { dryRun: boolean }): Telemetry {
  const failures: Error[] = []
  return telemetryWith(
    options.dryRun
      ? {
          span: new SimpleSpanProcessor({
            exporter: new ConsoleSpanExporter()
          }),
          log: new SimpleLogRecordProcessor({
            exporter: new ConsoleLogRecordExporter()
          })
        }
      : batchedProcessors(
          new FailureRecordingTraceExporter(failures),
          new FailureRecordingLogExporter(failures)
        ),
    failures
  )
}
