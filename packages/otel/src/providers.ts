import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan
} from '@opentelemetry/sdk-trace'
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
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

export function createTelemetry(options: { dryRun: boolean }): Telemetry {
  const failures: Error[] = []
  const resource = resourceFromAttributes({
    'service.name': DEFAULT_SERVICE_NAME
  }).merge(detectResources({ detectors: [envDetector] }))
  const tracerProvider = new TracerProvider({
    resource,
    spanProcessors: [
      options.dryRun
        ? new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })
        : new BatchSpanProcessor({
            exporter: new FailureRecordingTraceExporter(failures)
          })
    ]
  })
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      options.dryRun
        ? new SimpleLogRecordProcessor({
            exporter: new ConsoleLogRecordExporter()
          })
        : new BatchLogRecordProcessor({
            exporter: new FailureRecordingLogExporter(failures)
          })
    ]
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
