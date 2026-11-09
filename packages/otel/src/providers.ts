import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor
} from '@opentelemetry/sdk-trace'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  detectResources,
  envDetector,
  resourceFromAttributes
} from '@opentelemetry/resources'
import type { Tracer } from '@opentelemetry/api'
import { PinnedIdGenerator } from './span-ids.js'

const SCOPE_NAME = '@wdio/opentelemetry'
const DEFAULT_SERVICE_NAME = 'devtools-tests'
const EXPORT_SUCCESS_CODE = 0

// A push emits the whole run synchronously and flushes once, so a bounded queue (2048 by default) silently drops the overflow;
// the cost is that a run's whole span set can sit in memory until that flush.
const BATCH_LIMITS = { maxQueueSize: Number.MAX_SAFE_INTEGER }

// Events are capped per kind before they are added; the SDK's own limit of 128 per span would drop the oldest of a
// root's up to 200, so a test's first console errors vanished behind its failed requests.
export const SPAN_LIMITS = { eventCountLimit: Number.POSITIVE_INFINITY }

export function batchedProcessors(
  spanExporter: SpanExporter
): BatchSpanProcessor {
  return new BatchSpanProcessor({ exporter: spanExporter, ...BATCH_LIMITS })
}

// The batch processor discards a failed export, so the exporter records it for `flush` to rethrow: that is what
// makes the CLI exit non-zero.
export function recordingFailures(
  exporter: SpanExporter,
  failures: Error[]
): SpanExporter {
  return {
    export: (spans: ReadableSpan[], done) =>
      exporter.export(spans, (result) => {
        if (result.code !== EXPORT_SUCCESS_CODE) {
          failures.push(result.error ?? new Error('OTLP trace export failed'))
        }
        done(result)
      }),
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve()
  }
}

export interface Telemetry {
  tracer: Tracer
  ids: PinnedIdGenerator
  flush(): Promise<void>
  shutdown(): Promise<void>
}

export function telemetryWith(
  spanProcessor: SpanProcessor,
  failures: readonly Error[]
): Telemetry {
  const resource = resourceFromAttributes({
    'service.name': DEFAULT_SERVICE_NAME
  }).merge(detectResources({ detectors: [envDetector] }))
  const ids = new PinnedIdGenerator()
  // A remote parent with the sampled flag unset would otherwise drop every span.
  const tracerProvider = new TracerProvider({
    resource,
    sampler: new AlwaysOnSampler(),
    spanLimits: SPAN_LIMITS,
    idGenerator: ids,
    spanProcessors: [spanProcessor]
  })
  return {
    tracer: tracerProvider.getTracer(SCOPE_NAME),
    ids,
    // forceFlush rejects with the processor's own result array on a failed export, which says nothing; the
    // recorded error says why.
    async flush() {
      let rejection: { error: unknown } | undefined
      try {
        await tracerProvider.forceFlush()
      } catch (error) {
        rejection = { error }
      }
      const [first] = failures
      if (first) {
        throw first
      }
      if (rejection) {
        throw rejection.error
      }
    },
    async shutdown() {
      await tracerProvider.shutdown()
    }
  }
}

export function createTelemetry(options: { dryRun: boolean }): Telemetry {
  const failures: Error[] = []
  return telemetryWith(
    options.dryRun
      ? new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })
      : batchedProcessors(recordingFailures(new OTLPTraceExporter(), failures)),
    failures
  )
}
