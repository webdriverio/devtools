import { describe, expect, it } from 'vitest'
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  TracerProvider
} from '@opentelemetry/sdk-trace'
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider
} from '@opentelemetry/sdk-logs'
import { BATCH_LIMITS } from '../src/providers.js'

const RECORDS = 5000

describe('one flush per push', () => {
  it('exports every span emitted before it', async () => {
    const exporter = new InMemorySpanExporter()
    const provider = new TracerProvider({
      spanProcessors: [new BatchSpanProcessor({ exporter, ...BATCH_LIMITS })]
    })
    const tracer = provider.getTracer('t')
    for (let i = 0; i < RECORDS; i++) {
      tracer.startSpan(`s${i}`).end()
    }
    await provider.forceFlush()
    expect(exporter.getFinishedSpans()).toHaveLength(RECORDS)
  })

  it('exports every log record emitted before it', async () => {
    const exporter = new InMemoryLogRecordExporter()
    const provider = new LoggerProvider({
      processors: [new BatchLogRecordProcessor({ exporter, ...BATCH_LIMITS })]
    })
    const logger = provider.getLogger('t')
    for (let i = 0; i < RECORDS; i++) {
      logger.emit({ body: `r${i}` })
    }
    await provider.forceFlush()
    expect(exporter.getFinishedLogRecords()).toHaveLength(RECORDS)
  })
})
