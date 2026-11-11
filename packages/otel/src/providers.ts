import {
  AlwaysOnSampler,
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
import { TraceFlags, type Tracer } from '@opentelemetry/api'
import { ciResourceAttributes } from './ci.js'
import { PinnedIdGenerator } from './span-ids.js'

const SCOPE_NAME = '@wdio/opentelemetry'
const DEFAULT_SERVICE_NAME = 'devtools-tests'
const EXPORT_SUCCESS_CODE = 0
// The collector refuses more than a handful of concurrent exports, so the batches go out one after another.
const EXPORT_BATCH_SPANS = 512

// Events are capped per kind before they are added; the SDK's own limit of 128 per span would drop the oldest of a
// root's up to 200, so a test's first console errors vanished behind its failed requests.
export const SPAN_LIMITS = { eventCountLimit: Number.POSITIVE_INFINITY }

export interface ExportCount {
  readonly pending: number
  readonly exported: number
}

/** Holds ended spans until `forceFlush`, then exports them one batch at a time; a failed batch stays pending. */
export class SteppedExport implements SpanProcessor, ExportCount {
  #pending: ReadableSpan[] = []
  #exported = 0

  constructor(private readonly exporter: SpanExporter) {}

  get pending(): number {
    return this.#pending.length
  }

  get exported(): number {
    return this.#exported
  }

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0) {
      return
    }
    this.#pending.push(span)
  }

  async forceFlush(): Promise<void> {
    while (this.#pending.length > 0) {
      const batch = this.#pending.slice(0, EXPORT_BATCH_SPANS)
      await exportBatch(this.exporter, batch)
      this.#pending.splice(0, batch.length)
      this.#exported += batch.length
    }
  }

  // Pending spans are dropped: a failed flush must not be retried at exit.
  shutdown(): Promise<void> {
    return this.exporter.shutdown()
  }
}

function exportBatch(
  exporter: SpanExporter,
  spans: ReadableSpan[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    exporter.export(spans, (result) => {
      if (result.code === EXPORT_SUCCESS_CODE) {
        resolve()
      } else {
        reject(result.error ?? new Error('OTLP trace export failed'))
      }
    })
  })
}

export interface Telemetry {
  tracer: Tracer
  ids: PinnedIdGenerator
  flush(): Promise<void>
  shutdown(): Promise<void>
  pendingSpans(): number
  exportedSpans(): number
}

export function telemetryWith(
  spanProcessor: SpanProcessor,
  count: ExportCount,
  ciAttributes: Record<string, string>
): Telemetry {
  const resource = resourceFromAttributes({
    'service.name': DEFAULT_SERVICE_NAME,
    ...ciAttributes
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
    flush: () => spanProcessor.forceFlush(),
    async shutdown() {
      await tracerProvider.shutdown()
    },
    pendingSpans: () => count.pending,
    exportedSpans: () => count.exported
  }
}

export function createTelemetry(options: {
  dryRun: boolean
  env: Record<string, string | undefined>
}): Telemetry {
  const ci = ciResourceAttributes(options.env)
  if (options.dryRun) {
    return telemetryWith(
      new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }),
      { pending: 0, exported: 0 },
      ci
    )
  }
  const processor = new SteppedExport(new OTLPTraceExporter())
  return telemetryWith(processor, processor, ci)
}
