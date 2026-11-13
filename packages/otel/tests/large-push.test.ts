import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ARTIFACTS_MANIFEST_VERSION } from '@wdio/devtools-shared'
import type { Manifest } from '../src/manifest.js'
import { createTelemetry } from '../src/providers.js'
import { planPush } from '../src/to-telemetry.js'

const ATTEMPTS = 20_000
const LARGE_PUSH_TIMEOUT_MS = 20_000
const START_MS = Date.UTC(2025, 0, 1, 10, 0, 0)

interface OtlpSpan {
  name: string
  traceId: string
  parentSpanId?: string
}

interface OtlpBody {
  resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[]
}

interface Collector {
  server: Server
  spans: OtlpSpan[]
  requests: number
}

function startCollector(): Promise<Collector> {
  const collector: Collector = {
    server: createServer((request: IncomingMessage, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body: OtlpBody = JSON.parse(
          Buffer.concat(chunks).toString('utf8')
        )
        collector.requests++
        for (const resource of body.resourceSpans) {
          for (const scope of resource.scopeSpans) {
            collector.spans.push(...scope.spans)
          }
        }
        response.writeHead(200).end()
      })
    }),
    spans: [],
    requests: 0
  }
  return new Promise((resolve) => {
    collector.server.listen(0, '127.0.0.1', () => resolve(collector))
  })
}

function syntheticManifest(count: number): Manifest {
  return {
    manifestVersion: ARTIFACTS_MANIFEST_VERSION,
    sessionId: 'large',
    runId: 'run-large',
    artifacts: [],
    tests: Array.from({ length: count }, (_, index) => {
      const startTime = START_MS + index
      return {
        uid: `uid-${index}`,
        title: 'logs in',
        specFile: 'specs/login.spec.ts',
        state: 'passed',
        attempt: 0,
        attempts: [
          {
            attempt: 0,
            state: 'passed',
            startTime,
            endTime: startTime + 10,
            traceId: (index + 1).toString(16).padStart(32, '0'),
            spanId: index.toString(16).padStart(16, '0'),
            final: true
          }
        ]
      }
    })
  }
}

describe('large push', () => {
  let collector: Collector
  let previousEndpoint: string | undefined

  beforeAll(async () => {
    collector = await startCollector()
    const { port } = collector.server.address() as AddressInfo
    previousEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    if (previousEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previousEndpoint
    }
    collector.server.close()
  })

  it(
    'exports every test span, each in its own trace, across several flushes',
    async () => {
      const plan = planPush({
        manifests: [
          {
            file: '/large/devtools-artifacts-large.json',
            manifest: syntheticManifest(ATTEMPTS),
            mtimeMs: START_MS
          }
        ],
        traceZips: false,
        ignoreParentSampling: false,
        consoleMessages: false,
        realpath: (target) => target,
        loadZip: () => new Uint8Array(),
        warn: () => {}
      })
      const telemetry = createTelemetry({
        dryRun: false,
        ignoreParentSampling: false,
        env: {}
      })
      try {
        await plan.emit(telemetry)
      } finally {
        await telemetry.shutdown()
      }
      const tests = collector.spans.filter((span) => span.name === 'logs in')
      expect(tests).toHaveLength(ATTEMPTS)
      expect(new Set(tests.map((span) => span.traceId)).size).toBe(ATTEMPTS)
      expect(tests.filter((span) => span.parentSpanId)).toEqual([])
      expect(collector.requests).toBeGreaterThan(1)
    },
    LARGE_PUSH_TIMEOUT_MS
  )
})
