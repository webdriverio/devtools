import { describe, expect, it } from 'vitest'
import { InMemorySpanExporter, TracerProvider } from '@opentelemetry/sdk-trace'
import {
  InMemoryLogRecordExporter,
  LoggerProvider
} from '@opentelemetry/sdk-logs'
import { batchedProcessors, telemetryWith } from '../src/providers.js'

const RECORDS = 5000

function pushedThroughProduction() {
  const spans = new InMemorySpanExporter()
  const logs = new InMemoryLogRecordExporter()
  const processors = batchedProcessors(spans, logs)
  return {
    spans,
    logs,
    tracerProvider: new TracerProvider({ spanProcessors: [processors.span] }),
    loggerProvider: new LoggerProvider({ processors: [processors.log] })
  }
}

describe('one flush per push', () => {
  it('exports every span emitted before it', async () => {
    const { spans, tracerProvider } = pushedThroughProduction()
    const tracer = tracerProvider.getTracer('t')
    for (let i = 0; i < RECORDS; i++) {
      tracer.startSpan(`s${i}`).end()
    }
    await tracerProvider.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(RECORDS)
  })

  it('exports every log record emitted before it', async () => {
    const { logs, loggerProvider } = pushedThroughProduction()
    const logger = loggerProvider.getLogger('t')
    for (let i = 0; i < RECORDS; i++) {
      logger.emit({ body: `r${i}` })
    }
    await loggerProvider.forceFlush()
    expect(logs.getFinishedLogRecords()).toHaveLength(RECORDS)
  })
})

describe('span limits', () => {
  it('keeps every event added to a span, past the SDK default of 128', async () => {
    const spans = new InMemorySpanExporter()
    const telemetry = telemetryWith(
      batchedProcessors(spans, new InMemoryLogRecordExporter()),
      []
    )
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
