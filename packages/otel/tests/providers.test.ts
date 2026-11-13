import { describe, expect, it } from 'vitest'
import { ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  TracerProvider,
  type SpanExporter
} from '@opentelemetry/sdk-trace'
import { SteppedExport, telemetryWith } from '../src/providers.js'

const RECORDS = 5000
const SPAN_COUNT = 20_000
// ExportResultCode.FAILED; @opentelemetry/core is not a dependency of this package.
const EXPORT_FAILED = 1

function telemetryOver(
  exporter: SpanExporter,
  ci: Record<string, string> = {},
  ignoreParentSampling = false
) {
  const processor = new SteppedExport(exporter)
  return telemetryWith(processor, processor, ci, ignoreParentSampling)
}

describe('one flush per push', () => {
  it('exports every span emitted before it', async () => {
    const spans = new InMemorySpanExporter()
    const tracerProvider = new TracerProvider({
      spanProcessors: [new SteppedExport(spans)]
    })
    const tracer = tracerProvider.getTracer('t')
    for (let i = 0; i < RECORDS; i++) {
      tracer.startSpan(`s${i}`).end()
    }
    await tracerProvider.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(RECORDS)
  })
})

describe('telemetry wiring', () => {
  const unsampledParent = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    spanId: 'b7ad6b7169203331',
    traceFlags: TraceFlags.NONE,
    isRemote: true
  })

  it('drops a span whose TRACEPARENT parent is not sampled', async () => {
    const spans = new InMemorySpanExporter()
    const telemetry = telemetryOver(spans)
    telemetry.tracer.startSpan('child', {}, unsampledParent).end()
    await telemetry.flush()
    expect(spans.getFinishedSpans()).toEqual([])
  })

  it('exports a span whose TRACEPARENT parent is not sampled when parent sampling is ignored', async () => {
    const spans = new InMemorySpanExporter()
    const telemetry = telemetryOver(spans, {}, true)
    telemetry.tracer.startSpan('child', {}, unsampledParent).end()
    await telemetry.flush()
    expect(spans.getFinishedSpans().map((span) => span.name)).toEqual(['child'])
  })

  it('reports the end of the oldest sampled span', () => {
    const telemetry = telemetryOver(new InMemorySpanExporter())
    const startTime = new Date(500)
    telemetry.tracer.startSpan('late', { startTime }).end(new Date(2000))
    telemetry.tracer.startSpan('early', { startTime }).end(new Date(1000))
    expect(telemetry.oldestEndMs()).toBe(1000)
  })

  it('rejects the flush when the collector refused an export', async () => {
    const refusing: SpanExporter = {
      export: (_spans, done) =>
        done({ code: EXPORT_FAILED, error: new Error('refused') }),
      shutdown: async () => {}
    }
    const telemetry = telemetryOver(refusing)
    telemetry.tracer.startSpan('s').end()
    await expect(telemetry.flush()).rejects.toThrow('refused')
  })

  it('a user-set resource attribute wins over the detected one', async () => {
    const previous = process.env.OTEL_RESOURCE_ATTRIBUTES
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'vcs.ref.head.revision=from-user'
    try {
      const spans = new InMemorySpanExporter()
      const telemetry = telemetryOver(spans, {
        'vcs.ref.head.revision': 'from-ci',
        'cicd.pipeline.name': 'ci'
      })
      telemetry.tracer.startSpan('s').end()
      await telemetry.flush()
      expect(spans.getFinishedSpans()[0].resource.attributes).toMatchObject({
        'vcs.ref.head.revision': 'from-user',
        'cicd.pipeline.name': 'ci'
      })
    } finally {
      if (previous === undefined) {
        delete process.env.OTEL_RESOURCE_ATTRIBUTES
      } else {
        process.env.OTEL_RESOURCE_ATTRIBUTES = previous
      }
    }
  })
})

describe('span limits', () => {
  it('keeps every event the push adds, past the SDK default of 128', async () => {
    const spans = new InMemorySpanExporter()
    const telemetry = telemetryOver(spans)
    const span = telemetry.tracer.startSpan('root')
    for (let i = 0; i < 200; i++) {
      span.addEvent(`e${i}`)
    }
    span.end()
    await telemetry.flush()
    const events = spans.getFinishedSpans()[0].events
    expect([events.length, events[0].name]).toEqual([200, 'e0'])
  })
})

describe('bounded export', () => {
  // Fails any export that overlaps another, as the OTLP exporter does past its concurrency limit.
  function serialCollector(): {
    exporter: SpanExporter
    maxInFlight: () => number
    exported: () => number
  } {
    let inFlight = 0
    let maxInFlight = 0
    let exported = 0
    return {
      exporter: {
        export(spans, done) {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          setImmediate(() => {
            inFlight--
            if (maxInFlight > 1) {
              done({
                code: EXPORT_FAILED,
                error: new Error('Concurrent export limit reached')
              })
              return
            }
            exported += spans.length
            done({ code: 0 })
          })
        },
        shutdown: async () => {}
      },
      maxInFlight: () => maxInFlight,
      exported: () => exported
    }
  }

  it('never runs two exports at once', async () => {
    const collector = serialCollector()
    const telemetry = telemetryOver(collector.exporter)
    for (let i = 0; i < SPAN_COUNT; i++) {
      telemetry.tracer.startSpan(`s${i}`).end()
    }
    await telemetry.flush()
    expect([collector.maxInFlight(), collector.exported()]).toEqual([
      1,
      SPAN_COUNT
    ])
  })

  it('counts what reached the collector before a failed batch', async () => {
    let calls = 0
    const failThird: SpanExporter = {
      export(_spans, done) {
        calls++
        done(
          calls === 3
            ? { code: EXPORT_FAILED, error: new Error('refused') }
            : { code: 0 }
        )
      },
      shutdown: async () => {}
    }
    const telemetry = telemetryOver(failThird)
    for (let i = 0; i < 5000; i++) {
      telemetry.tracer.startSpan(`s${i}`).end()
    }
    await expect(telemetry.flush()).rejects.toThrow('refused')
    expect([telemetry.exportedSpans(), telemetry.pendingSpans()]).toEqual([
      1024, 3976
    ])
  })
})
