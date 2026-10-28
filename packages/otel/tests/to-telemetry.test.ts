import path from 'node:path'
import { SpanStatusCode } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor
} from '@opentelemetry/sdk-logs'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan
} from '@opentelemetry/sdk-trace'
import { buildTraceZip } from '@wdio/devtools-trace'
import { describe, expect, it } from 'vitest'
import * as attr from '../src/attributes.js'
import type { Manifest } from '../src/manifest.js'
import { planPush } from '../src/to-telemetry.js'

const EPOCH_2025 = Date.UTC(2025, 0, 1, 10, 0, 0)
const HOUR_MS = 60 * 60 * 1000
const MTIME_MS = EPOCH_2025 - 5000
const NOW_MS = EPOCH_2025 + 60_000
const RUN_DIR = path.resolve('otel-run')
const MANIFEST_FILE = path.join(RUN_DIR, 'devtools-artifacts-s1.json')
const ZIP_PATH = path.join(RUN_DIR, 'traces', 's1-login.zip')

const ndjson = (events: object[]): string =>
  events.map((event) => JSON.stringify(event)).join('\n')

const contextOptions = {
  type: 'context-options',
  contextId: 'ctx@s1',
  wallTime: EPOCH_2025,
  monotonicTime: 0,
  options: { viewport: { width: 800, height: 600 } }
}

const loginEvents = [
  contextOptions,
  {
    type: 'before',
    callId: 'g1',
    startTime: 1000,
    class: 'Tracing',
    method: 'tracingGroup',
    pageId: 'p',
    params: {},
    title: 'Login',
    apiName: 'tracing.group'
  },
  {
    type: 'before',
    callId: 'c1',
    startTime: 1100,
    class: 'Element',
    method: 'click',
    pageId: 'p',
    params: { locator: '  #login   button ' },
    title: 'Element.click',
    apiName: 'element.click',
    parentId: 'g1'
  },
  { type: 'after', callId: 'c1', endTime: 1200 },
  {
    type: 'before',
    callId: 'c2',
    startTime: 1300,
    class: 'Element',
    method: 'waitForDisplayed',
    pageId: 'p',
    params: { locator: '#dashboard' },
    title: 'Element.waitForDisplayed',
    apiName: 'element.waitForDisplayed',
    parentId: 'g1'
  },
  {
    type: 'after',
    callId: 'c2',
    endTime: 1500,
    error: { message: 'not visible' }
  },
  { type: 'after', callId: 'g1', endTime: 1600 }
]

const HAR_500 = {
  startedDateTime: new Date(EPOCH_2025 + 1400).toISOString(),
  time: 20,
  request: {
    method: 'GET',
    url: 'https://app.test/api/items?id=7&token=secret',
    headers: []
  },
  response: {
    status: 500,
    statusText: 'Server Error',
    headers: [],
    content: { size: 0, mimeType: 'application/json' }
  }
}

const HAR_200 = { ...HAR_500, response: { ...HAR_500.response, status: 200 } }

async function zipOf(
  events: object[],
  network: object[] = []
): Promise<Uint8Array> {
  return new Uint8Array(
    await buildTraceZip({
      traceNdjson: ndjson(events),
      networkNdjson: Buffer.from(
        ndjson(network.map((snapshot) => ({ snapshot }))),
        'utf8'
      ),
      resources: []
    })
  )
}

function manifestOf(overrides: Partial<Manifest> = {}): Manifest {
  return {
    sessionId: 's1',
    artifacts: [
      {
        kind: 'trace',
        path: 'traces/s1-login.zip',
        testUids: ['uid-login'],
        retained: true
      }
    ],
    tests: [
      {
        uid: 'uid-login',
        title: 'logs in',
        specFile: 'specs/login.spec.ts',
        state: 'failed',
        attempt: 1
      }
    ],
    ...overrides
  }
}

interface PushOptions {
  manifests?: { file: string; manifest: Manifest; mtimeMs?: number }[]
  zips?: Map<string, Uint8Array>
  artifactBaseUrl?: string
  nowMs?: number
  flush?: () => Promise<void>
}

async function push(options: PushOptions = {}) {
  const warnings: string[] = []
  const spanExporter = new InMemorySpanExporter()
  const logExporter = new InMemoryLogRecordExporter()
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })]
  })
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })]
  })
  const zips = options.zips ?? new Map([[ZIP_PATH, await zipOf(loginEvents)]])
  const manifests = options.manifests ?? [
    { file: MANIFEST_FILE, manifest: manifestOf() }
  ]
  const plan = planPush({
    manifests: manifests.map((entry) => ({ mtimeMs: MTIME_MS, ...entry })),
    runId: 'run-1',
    nowMs: options.nowMs ?? NOW_MS,
    artifactBaseUrl: options.artifactBaseUrl,
    loadZip: (zipPath) => {
      const zip = zips.get(zipPath)
      if (!zip) {
        throw new Error(`no fixture for ${zipPath}`)
      }
      return zip
    },
    warn: (message) => warnings.push(message)
  })
  if (plan.problems.length === 0) {
    await plan.emit({
      tracer: tracerProvider.getTracer('test'),
      logger: loggerProvider.getLogger('test'),
      flush: options.flush ?? (async () => {})
    })
  }
  return {
    spans: spanExporter.getFinishedSpans(),
    logs: logExporter.getFinishedLogRecords(),
    warnings,
    problems: plan.problems
  }
}

const toMs = (time: [number, number]): number => time[0] * 1000 + time[1] / 1e6

const byName = (spans: ReadableSpan[], name: string): ReadableSpan => {
  const found = spans.find((span) => span.name === name)
  if (!found) {
    throw new Error(
      `no span named ${name}; have ${spans.map((s) => s.name).join(', ')}`
    )
  }
  return found
}

describe('pushRun span tree', () => {
  it('nests actions under their tracing group and roots them in the test', async () => {
    const { spans } = await push()
    const root = byName(spans, 'logs in')
    const group = byName(spans, 'Login')
    const click = byName(spans, 'Element.click')
    const wait = byName(spans, 'Element.waitForDisplayed')
    expect(root.parentSpanContext).toBeUndefined()
    expect(group.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    expect(click.parentSpanContext?.spanId).toBe(group.spanContext().spanId)
    expect(wait.parentSpanContext?.spanId).toBe(group.spanContext().spanId)
  })

  it('keeps real epoch times on the root and action spans', async () => {
    const { spans } = await push()
    const root = byName(spans, 'logs in')
    const click = byName(spans, 'Element.click')
    expect(toMs(root.startTime)).toBe(EPOCH_2025 + 1000)
    expect(toMs(root.endTime)).toBe(EPOCH_2025 + 1600)
    expect(toMs(click.startTime)).toBe(EPOCH_2025 + 1100)
    expect(toMs(click.endTime)).toBe(EPOCH_2025 + 1200)
  })

  it('bounds every child span within the root span', async () => {
    const { spans } = await push()
    const root = byName(spans, 'logs in')
    const children = spans.filter(
      (span) => span.spanContext().spanId !== root.spanContext().spanId
    )
    expect(children.length).toBeGreaterThan(0)
    for (const child of children) {
      expect(toMs(child.startTime)).toBeGreaterThanOrEqual(toMs(root.startTime))
      expect(toMs(child.endTime)).toBeLessThanOrEqual(toMs(root.endTime))
    }
  })

  it('marks the failing action and the root with ERROR and records the exception', async () => {
    const { spans } = await push()
    const wait = byName(spans, 'Element.waitForDisplayed')
    const root = byName(spans, 'logs in')
    expect(wait.status.code).toBe(SpanStatusCode.ERROR)
    expect(wait.events.some((event) => event.name === 'exception')).toBe(true)
    expect(root.status.code).toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBe(
      'waitForDisplayed #dashboard'
    )
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBe('not visible')
  })

  it('stamps each action with a normalized key and its chronological index', async () => {
    const { spans } = await push()
    const click = byName(spans, 'Element.click')
    const wait = byName(spans, 'Element.waitForDisplayed')
    expect(click.attributes[attr.ATTR_ACTION_KEY]).toBe('click #login button')
    expect(click.attributes[attr.ATTR_ACTION_INDEX]).toBe(0)
    expect(wait.attributes[attr.ATTR_ACTION_INDEX]).toBe(1)
  })

  it('records console errors and failed requests as span events without the query string', async () => {
    const consoleEvents = Array.from({ length: 150 }, (_, i) => ({
      type: 'console',
      time: 1150 + i,
      messageType: 'error',
      text: `boom ${i}`,
      location: {
        url: 'https://app.test/app.js',
        lineNumber: 1,
        columnNumber: 1
      }
    }))
    const zip = await zipOf(
      [...loginEvents, ...consoleEvents],
      [HAR_500, HAR_200]
    )
    const { spans } = await push({ zips: new Map([[ZIP_PATH, zip]]) })
    const root = byName(spans, 'logs in')
    const consoleCount = root.events.filter(
      (event) => event.name === attr.EVENT_CONSOLE
    ).length
    expect(consoleCount).toBe(100)
    const failed = root.events.filter(
      (event) => event.name === attr.EVENT_REQUEST_FAILED
    )
    expect(failed).toHaveLength(1)
    expect(failed[0].attributes?.[attr.ATTR_URL_PATH]).toBe('/api/items')
  })
})

describe('pushRun logs', () => {
  it('emits one ERROR log per failed test, inside the root span context', async () => {
    const { spans, logs } = await push()
    const root = byName(spans, 'logs in')
    expect(logs).toHaveLength(1)
    const [log] = logs
    expect(log.severityNumber).toBe(SeverityNumber.ERROR)
    expect(log.spanContext?.traceId).toBe(root.spanContext().traceId)
    expect(log.spanContext?.spanId).toBe(root.spanContext().spanId)
    expect(log.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_FAIL
    )
    expect(log.attributes[attr.ATTR_TEST_CASE_NAME]).toBe('logs in')
    expect(log.attributes[attr.ATTR_TEST_SUITE_NAME]).toBe(
      'specs/login.spec.ts'
    )
    expect(log.attributes[attr.ATTR_RUN_ID]).toBe('run-1')
  })

  it('derives no failure from a passing test whose traced command erred', async () => {
    const manifest = manifestOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 1
        }
      ]
    })
    const { spans, logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const root = byName(spans, 'logs in')
    expect(byName(spans, 'Element.waitForDisplayed').status.code).toBe(
      SpanStatusCode.ERROR
    )
    expect(root.status.code).not.toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_FAILED_ACTION]).toBeUndefined()
  })

  it('maps a passing test to pass and an INFO log', async () => {
    const manifest = manifestOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 2
        }
      ]
    })
    const { spans, logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(byName(spans, 'logs in').status.code).not.toBe(SpanStatusCode.ERROR)
    expect(logs[0].severityNumber).toBe(SeverityNumber.INFO)
    expect(logs[0].attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_PASS
    )
    expect(logs[0].attributes[attr.ATTR_TEST_ATTEMPT]).toBe(2)
  })

  it('emits a log without a trace context for a test that has no retained zip', async () => {
    const manifest = manifestOf({ artifacts: [] })
    const { spans, logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(spans).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0].spanContext).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_DURATION_MS]).toBeUndefined()
  })

  it('links the artifact URL to the zip relative to the base URL', async () => {
    const { spans, logs } = await push({
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    const expected = 'https://bucket.example/run-1/traces/s1-login.zip'
    expect(byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      expected
    )
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBe(expected)
  })

  it('links an absolute artifact path relative to its manifest directory', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = path.join(RUN_DIR, 'traces/s1-login.zip')
    const { logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/traces/s1-login.zip'
    )
  })

  it('percent-encodes reserved characters in the artifact path', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = 'traces/s1 #2.zip'
    const { logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: new Map([
        [path.join(RUN_DIR, 'traces', 's1 #2.zip'), await zipOf(loginEvents)]
      ]),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/traces/s1%20%232.zip'
    )
  })

  it('traces a scenario whose zip also lists its step uids', async () => {
    const manifest = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/s1-login.zip',
          testUids: ['uid-login', 'step-1', 'step-2'],
          retained: true
        }
      ]
    })
    const { spans, logs, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(byName(spans, 'logs in')).toBeDefined()
    expect(logs[0].spanContext).toBeDefined()
    expect(warnings).toHaveLength(0)
  })

  it('links no artifact URL for a zip outside the manifest directory and warns', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = '../elsewhere/s1.zip'
    const { logs, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: new Map([
        [path.resolve(RUN_DIR, '../elsewhere/s1.zip'), await zipOf(loginEvents)]
      ]),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('outside the manifest directory')
  })

  it('skips the trace of tests sharing a zip and warns once per manifest', async () => {
    const manifest = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/s1-login.zip',
          testUids: ['uid-login', 'uid-other'],
          retained: true
        }
      ],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'failed',
          attempt: 1
        },
        {
          uid: 'uid-other',
          title: 'other',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 1
        }
      ]
    })
    const { spans, logs, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(spans).toHaveLength(0)
    expect(logs).toHaveLength(2)
    expect(logs.every((log) => log.spanContext === undefined)).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("traceGranularity:'test' is required")
  })

  it('groups tests from several manifests under the one run id', async () => {
    const second: Manifest = manifestOf({
      sessionId: 's2',
      artifacts: [],
      tests: [
        {
          uid: 'uid-other',
          title: 'other',
          specFile: 'specs/other.spec.ts',
          state: 'passed',
          attempt: 1
        }
      ]
    })
    const { logs } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: manifestOf() },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: second
        }
      ]
    })
    expect(logs).toHaveLength(2)
    expect(
      new Set(logs.map((log) => log.attributes[attr.ATTR_RUN_ID]))
    ).toEqual(new Set(['run-1']))
  })
})

const RETRIED_UID = 'stable-uk6uor'
const RETRIED_TITLE = 'fails the first attempt, then passes'
const RETRIED_SPEC = 'specs/flaky.spec.ts'

const passingLogin = loginEvents.map((event) =>
  'callId' in event && event.callId === 'c2' && event.type === 'after'
    ? { type: 'after', callId: 'c2', endTime: 1500 }
    : event
)

function retriedManifest(
  artifacts: Manifest['artifacts'],
  overrides: Partial<Manifest['tests'][number]> = {}
): Manifest {
  return {
    sessionId: 's1',
    artifacts,
    tests: [
      {
        uid: RETRIED_UID,
        title: RETRIED_TITLE,
        specFile: RETRIED_SPEC,
        state: 'passed',
        attempt: 1,
        ...overrides
      }
    ]
  }
}

describe('pushRun attempt selection', () => {
  const keyedArtifacts: Manifest['artifacts'] = [
    {
      kind: 'trace',
      path: 'a/trace.zip',
      key: RETRIED_UID,
      testUids: [RETRIED_UID],
      retained: true
    },
    {
      kind: 'trace',
      path: 'b-retry1/trace.zip',
      key: `${RETRIED_UID}-retry1`,
      testUids: [RETRIED_UID],
      retained: true
    }
  ]
  const retryZips = async () =>
    new Map([
      [path.join(RUN_DIR, 'a/trace.zip'), await zipOf(loginEvents)],
      [path.join(RUN_DIR, 'b-retry1/trace.zip'), await zipOf(passingLogin)]
    ])

  it('records the final attempt, not the failing first attempt', async () => {
    const { spans, logs, problems } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: retriedManifest(keyedArtifacts) }
      ],
      zips: await retryZips(),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(problems).toEqual([])
    const [log] = logs
    expect(log.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_PASS
    )
    expect(log.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(log.attributes[attr.ATTR_FAILED_ACTION]).toBeUndefined()
    expect(log.attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/b-retry1/trace.zip'
    )
    expect(byName(spans, RETRIED_TITLE).status.code).not.toBe(
      SpanStatusCode.ERROR
    )
  })

  it('falls back to the highest retry suffix when the manifest has no keys', async () => {
    const unkeyed: Manifest['artifacts'] = keyedArtifacts.map(
      ({ path: artifactPath, testUids, kind, retained }) => ({
        kind,
        path: artifactPath,
        testUids,
        retained
      })
    )
    const { logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: retriedManifest(unkeyed) }],
      zips: await retryZips(),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(logs[0].attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/b-retry1/trace.zip'
    )
  })

  it('never stands an earlier attempt zip in for a final attempt that has none', async () => {
    const firstOnly: Manifest['artifacts'] = [keyedArtifacts[0]]
    const { logs, problems } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: retriedManifest(firstOnly) }
      ],
      zips: await retryZips()
    })
    expect(problems).toEqual([])
    expect(logs[0].spanContext).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_ARTIFACT_URL]).toBeUndefined()
    expect(logs[0].attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_MANIFEST_FILE
    )
  })
})

describe('pushRun timing', () => {
  it('takes timestamp, duration and error from the manifest when it has them', async () => {
    const manifest = manifestOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'failed',
          attempt: 1,
          startTime: EPOCH_2025 + 500,
          endTime: EPOCH_2025 + 9000,
          durationMs: 8500,
          error: 'framework says no'
        }
      ]
    })
    const { spans, logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const [log] = logs
    expect(toMs(log.hrTime)).toBe(EPOCH_2025 + 9000)
    expect(log.attributes[attr.ATTR_DURATION_MS]).toBe(8500)
    expect(log.attributes[attr.ATTR_ERROR_MESSAGE]).toBe('framework says no')
    expect(log.attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_MANIFEST
    )
    expect(toMs(byName(spans, 'logs in').startTime)).toBe(EPOCH_2025 + 1000)
  })

  it('derives the duration from start and end when the manifest gives no durationMs', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0,
          startTime: EPOCH_2025,
          endTime: EPOCH_2025 + 8000
        }
      ]
    })
    const { logs } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(logs[0].attributes[attr.ATTR_DURATION_MS]).toBe(8000)
  })

  it('timestamps a record with no zip and no manifest timing from the manifest file', async () => {
    const { logs } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: manifestOf({ artifacts: [] }) }
      ]
    })
    expect(toMs(logs[0].hrTime)).toBe(MTIME_MS)
    expect(logs[0].attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_MANIFEST_FILE
    )
  })

  it('stamps trace-derived records with trace time', async () => {
    const { logs } = await push()
    expect(toMs(logs[0].hrTime)).toBe(EPOCH_2025 + 1000)
    expect(logs[0].attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_TRACE
    )
  })

  it('emits records in ascending timestamp order across manifests', async () => {
    const late = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'late',
          title: 'late',
          specFile: 'specs/a.spec.ts',
          state: 'passed',
          attempt: 0,
          endTime: EPOCH_2025 + 9000
        }
      ]
    })
    const early = manifestOf({
      sessionId: 's2',
      artifacts: [],
      tests: [
        {
          uid: 'early',
          title: 'early',
          specFile: 'specs/b.spec.ts',
          state: 'passed',
          attempt: 0,
          endTime: EPOCH_2025 + 1000
        }
      ]
    })
    const { logs } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: late },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: early
        }
      ]
    })
    expect(logs.map((log) => log.body)).toEqual(['early', 'late'])
  })

  it('warns once when the records span more than an hour', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'old',
          title: 'old',
          specFile: 'specs/a.spec.ts',
          state: 'passed',
          attempt: 0,
          endTime: EPOCH_2025 - 2 * HOUR_MS
        },
        {
          uid: 'new',
          title: 'new',
          specFile: 'specs/a.spec.ts',
          state: 'passed',
          attempt: 0,
          endTime: EPOCH_2025 + 1000
        }
      ]
    })
    const { warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Loki')
    expect(warnings[0]).toContain(
      new Date(EPOCH_2025 - 2 * HOUR_MS).toISOString()
    )
    expect(warnings[0]).toContain('packages/otel/README.md')
  })

  it('warns when the oldest record is more than an hour behind now', async () => {
    const { warnings } = await push({
      nowMs: EPOCH_2025 + 2 * HOUR_MS,
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: manifestOf({ artifacts: [] }),
          mtimeMs: MTIME_MS
        }
      ]
    })
    expect(warnings).toHaveLength(1)
  })
})

describe('pushRun export failure', () => {
  it('reports how many records were pushed before a flush failed', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [0, 1, 2].map((i) => ({
        uid: `uid-${i}`,
        title: `test ${i}`,
        specFile: 'specs/a.spec.ts',
        state: 'passed',
        attempt: 0,
        endTime: EPOCH_2025 + i * 1000
      }))
    })
    let flushes = 0
    await expect(
      push({
        manifests: [{ file: MANIFEST_FILE, manifest }],
        flush: async () => {
          flushes++
          if (flushes === 2) {
            throw new Error('collector unreachable')
          }
        }
      })
    ).rejects.toThrow(
      '1 of 3 test(s) were pushed before the export failed: collector unreachable'
    )
  })
})

describe('pushRun preflight', () => {
  it('lists every unreadable zip and plans no records', async () => {
    const second = manifestOf({
      sessionId: 's2',
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/bad.zip',
          testUids: ['uid-login'],
          retained: true
        }
      ]
    })
    const { logs, problems } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: manifestOf() },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: second
        }
      ],
      zips: new Map([
        [path.join(RUN_DIR, 'traces', 'bad.zip'), new Uint8Array([1, 2, 3])]
      ])
    })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain(ZIP_PATH)
    expect(problems[1]).toContain(path.join(RUN_DIR, 'traces', 'bad.zip'))
    expect(logs).toHaveLength(0)
  })
})
