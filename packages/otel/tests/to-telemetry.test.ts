import path from 'node:path'
import { SpanStatusCode, TraceFlags } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan
} from '@opentelemetry/sdk-trace'
import {
  ARTIFACTS_MANIFEST_VERSION,
  type TestAttemptRecord
} from '@wdio/devtools-shared'
import { buildTraceZip } from '@wdio/devtools-trace'
import { describe, expect, it } from 'vitest'
import * as attr from '../src/attributes.js'
import type { Manifest } from '../src/manifest.js'
import { derivedSpanId, PinnedIdGenerator } from '../src/span-ids.js'
import { SPAN_LIMITS, telemetryWith } from '../src/providers.js'
import {
  MAX_CONSOLE_MESSAGE_CHARS,
  MAX_EVENTS_PER_TEST
} from '../src/emit-spans.js'
import { planPush, type PushPlan } from '../src/to-telemetry.js'

const EPOCH_2025 = Date.UTC(2025, 0, 1, 10, 0, 0)
const MTIME_MS = EPOCH_2025 - 5000
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
    manifestVersion: ARTIFACTS_MANIFEST_VERSION,
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
        attempt: 0
      }
    ],
    ...overrides
  }
}

interface PushOptions {
  manifests?: { file: string; manifest: Manifest }[]
  runId?: string | null
  zips?: Map<string, Uint8Array>
  artifactBaseUrl?: string
  flush?: () => Promise<void>
  pendingSpans?: () => number
  traceZips?: boolean
  consoleMessages?: boolean
  ignoreParentSampling?: boolean
}

async function push(options: PushOptions = {}) {
  const warnings: string[] = []
  const spanExporter = new InMemorySpanExporter()
  const ids = new PinnedIdGenerator()
  const tracerProvider = new TracerProvider({
    idGenerator: ids,
    spanLimits: SPAN_LIMITS,
    spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })]
  })
  const zips = options.zips ?? new Map([[ZIP_PATH, await zipOf(loginEvents)]])
  const manifests = options.manifests ?? [
    { file: MANIFEST_FILE, manifest: manifestOf() }
  ]
  const plan = planPush({
    manifests: manifests.map((entry) => ({ mtimeMs: MTIME_MS, ...entry })),
    runId: options.runId === null ? undefined : (options.runId ?? 'run-1'),
    artifactBaseUrl: options.artifactBaseUrl,
    traceZips: options.traceZips ?? true,
    ignoreParentSampling: options.ignoreParentSampling ?? false,
    consoleMessages: options.consoleMessages ?? false,
    realpath: (target) => target,
    loadZip: (zipPath) => {
      const zip = zips.get(zipPath)
      if (!zip) {
        throw new Error(`no fixture for ${zipPath}`)
      }
      return zip
    },
    warn: (message) => warnings.push(message)
  })
  await plan.emit({
    tracer: tracerProvider.getTracer('test'),
    ids,
    flush: options.flush ?? (async () => {}),
    pendingSpans: options.pendingSpans ?? (() => 0),
    exportedSpans: () => 0
  })
  return {
    spans: spanExporter.getFinishedSpans(),
    warnings
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

  it('widens a root whose manifest timing is narrower than its actions', async () => {
    const manifest = manifestOf()
    manifest.tests[0].startTime = EPOCH_2025 + 1100
    manifest.tests[0].endTime = EPOCH_2025 + 1200
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const root = byName(spans, 'logs in')
    expect(toMs(root.startTime)).toBeLessThan(EPOCH_2025 + 1100)
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

  it("nests a wait's polls under its span, a retried poll not marked ERROR", async () => {
    const events = [
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
        callId: 'w',
        startTime: 1100,
        class: 'Element',
        method: 'waitForDisplayed',
        pageId: 'p',
        params: { locator: '#dashboard' },
        title: 'Element.waitForDisplayed',
        apiName: 'element.waitForDisplayed',
        parentId: 'g1'
      },
      {
        type: 'before',
        callId: 'poll',
        startTime: 1110,
        class: 'Element',
        method: 'isDisplayed',
        pageId: 'p',
        params: { locator: '#dashboard' },
        title: 'Element.isDisplayed',
        apiName: 'element.isDisplayed',
        parentId: 'w'
      },
      {
        type: 'after',
        callId: 'poll',
        endTime: 1120,
        error: { message: 'no' }
      },
      { type: 'after', callId: 'w', endTime: 1200 },
      { type: 'after', callId: 'g1', endTime: 1300 }
    ]
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, await zipOf(events)]])
    })
    const wait = byName(spans, 'Element.waitForDisplayed')
    const poll = byName(spans, 'Element.isDisplayed')
    expect(poll.parentSpanContext?.spanId).toBe(wait.spanContext().spanId)
    expect(poll.status.code).not.toBe(SpanStatusCode.ERROR)
  })

  it('attributes a failed test to its failed wait, not a poll the wait retried past', async () => {
    const events = [
      contextOptions,
      {
        type: 'before',
        callId: 'w',
        startTime: 1000,
        class: 'Element',
        method: 'waitForDisplayed',
        pageId: 'p',
        params: { locator: '#dashboard' },
        title: 'Element.waitForDisplayed',
        apiName: 'element.waitForDisplayed'
      },
      {
        type: 'before',
        callId: 'poll',
        startTime: 1010,
        class: 'Element',
        method: 'isDisplayed',
        pageId: 'p',
        params: { locator: '#dashboard' },
        title: 'Element.isDisplayed',
        apiName: 'element.isDisplayed',
        parentId: 'w'
      },
      {
        type: 'after',
        callId: 'poll',
        endTime: 1020,
        error: { message: 'no' }
      },
      { type: 'after', callId: 'w', endTime: 1100 },
      {
        type: 'before',
        callId: 'c',
        startTime: 1200,
        class: 'Element',
        method: 'click',
        pageId: 'p',
        params: { locator: '#go' },
        title: 'Element.click',
        apiName: 'element.click'
      },
      { type: 'after', callId: 'c', endTime: 1300, error: { message: 'boom' } }
    ]
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, await zipOf(events)]])
    })
    const root = byName(spans, 'logs in')
    const erroredActions = spans
      .filter(
        (span) =>
          span.spanContext().spanId !== root.spanContext().spanId &&
          span.status.code === SpanStatusCode.ERROR
      )
      .map((span) => span.name)
    expect(erroredActions).toEqual(['Element.click'])
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBe('click #go')
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBe('boom')
  })

  it('attributes a failed test to a wait that resolved false', async () => {
    const events = [
      contextOptions,
      {
        type: 'before',
        callId: 'w',
        startTime: 1000,
        class: 'Element',
        method: 'waitForDisplayed',
        pageId: 'p',
        params: { locator: '#dashboard' },
        title: 'Element.waitForDisplayed',
        apiName: 'element.waitForDisplayed'
      },
      { type: 'after', callId: 'w', endTime: 1500, result: false }
    ]
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, await zipOf(events)]])
    })
    const wait = byName(spans, 'Element.waitForDisplayed')
    const root = byName(spans, 'logs in')
    expect(wait.status.code).toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBe(
      'waitForDisplayed #dashboard'
    )
  })

  it("caps a failing action's span status and exception message", async () => {
    const long = 'y'.repeat(10_000)
    const events = [
      contextOptions,
      {
        type: 'before',
        callId: 'c',
        startTime: 1000,
        class: 'Element',
        method: 'click',
        pageId: 'p',
        params: { locator: '#go' },
        title: 'Element.click',
        apiName: 'element.click'
      },
      { type: 'after', callId: 'c', endTime: 1100, error: { message: long } }
    ]
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, await zipOf(events)]])
    })
    const click = byName(spans, 'Element.click')
    const capped = `${'y'.repeat(4096)}…`
    expect(click.status.message).toBe(capped)
    expect(
      click.events.find((event) => event.name === 'exception')?.attributes?.[
        'exception.message'
      ]
    ).toBe(capped)
  })

  it('stamps each action with a normalized key and its chronological index', async () => {
    const { spans } = await push()
    const click = byName(spans, 'Element.click')
    const wait = byName(spans, 'Element.waitForDisplayed')
    expect(click.attributes[attr.ATTR_ACTION_KEY]).toBe('click #login button')
    expect(click.attributes[attr.ATTR_ACTION_INDEX]).toBe(0)
    expect(wait.attributes[attr.ATTR_ACTION_INDEX]).toBe(1)
  })

  it('records console errors as span events when console messages are requested', async () => {
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
      [...Array.from({ length: 150 }, () => HAR_500), HAR_200]
    )
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, zip]]),
      consoleMessages: true
    })
    const root = byName(spans, 'logs in')
    const consoleMessages = root.events
      .filter((event) => event.name === attr.EVENT_CONSOLE)
      .map((event) => event.attributes?.[attr.ATTR_CONSOLE_MESSAGE])
    expect(consoleMessages).toHaveLength(MAX_EVENTS_PER_TEST)
    expect([
      consoleMessages[0],
      consoleMessages[consoleMessages.length - 1]
    ]).toEqual(['boom 0', `boom ${MAX_EVENTS_PER_TEST - 1}`])
    const firstConsole = root.events.find(
      (event) => event.name === attr.EVENT_CONSOLE
    )
    expect(firstConsole?.attributes).toEqual({
      'devtools.console.type': 'error',
      'devtools.console.message': 'boom 0'
    })
    const failed = root.events.filter(
      (event) => event.name === attr.EVENT_REQUEST_FAILED
    )
    expect(failed).toHaveLength(MAX_EVENTS_PER_TEST)
    expect(failed[0].attributes?.[attr.ATTR_URL_PATH]).toBe('/api/items')
  })

  it('pushes failed requests without the query string and no console events by default', async () => {
    const consoleEvents = Array.from({ length: 3 }, (_, i) => ({
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
      Array.from({ length: 3 }, () => HAR_500)
    )
    const { spans } = await push({ zips: new Map([[ZIP_PATH, zip]]) })
    const root = byName(spans, 'logs in')
    expect(
      root.events.filter((event) => event.name === attr.EVENT_CONSOLE)
    ).toEqual([])
    const failed = root.events.filter(
      (event) => event.name === attr.EVENT_REQUEST_FAILED
    )
    expect(failed).toHaveLength(3)
    expect(failed[0].attributes?.[attr.ATTR_URL_PATH]).toBe('/api/items')
  })

  it('caps a console message at MAX_CONSOLE_MESSAGE_CHARS', async () => {
    const zip = await zipOf([
      ...loginEvents,
      {
        type: 'console',
        time: 1150,
        messageType: 'error',
        text: 'x'.repeat(MAX_CONSOLE_MESSAGE_CHARS + 500),
        location: {
          url: 'https://app.test/app.js',
          lineNumber: 1,
          columnNumber: 1
        }
      }
    ])
    const { spans } = await push({
      zips: new Map([[ZIP_PATH, zip]]),
      consoleMessages: true
    })
    const message = byName(spans, 'logs in').events.find(
      (event) => event.name === attr.EVENT_CONSOLE
    )?.attributes?.[attr.ATTR_CONSOLE_MESSAGE]
    expect(message).toBe(`${'x'.repeat(MAX_CONSOLE_MESSAGE_CHARS)}…`)
  })
})

describe('pushRun root spans', () => {
  it('names the root of a failed test with its status, suite and run', async () => {
    const { spans } = await push()
    const root = byName(spans, 'logs in')
    expect(root.status.code).toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_FAIL
    )
    expect(root.attributes[attr.ATTR_TEST_CASE_NAME]).toBe('logs in')
    expect(root.attributes[attr.ATTR_TEST_SUITE_NAME]).toBe(
      'specs/login.spec.ts'
    )
    expect(root.attributes[attr.ATTR_RUN_ID]).toBe('run-1')
  })

  it('derives no failure from a passing test whose traced command erred', async () => {
    const manifest = manifestOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0
        }
      ]
    })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const root = byName(spans, 'logs in')
    expect(byName(spans, 'Element.waitForDisplayed').status.code).toBe(
      SpanStatusCode.ERROR
    )
    expect(root.status.code).not.toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBeUndefined()
  })

  it('maps a passing test to a pass status on its final attempt', async () => {
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
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const root = byName(spans, 'logs in')
    expect(root.status.code).not.toBe(SpanStatusCode.ERROR)
    expect(root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_PASS
    )
    expect(root.attributes[attr.ATTR_TEST_ATTEMPT]).toBe(2)
  })

  it('roots a test with no retained zip in its own span without a duration', async () => {
    const manifest = manifestOf({ artifacts: [] })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(byName(spans, 'logs in').attributes[attr.ATTR_DURATION_MS]).toBe(
      undefined
    )
  })

  it('links the artifact URL to the zip relative to the base URL', async () => {
    const { spans } = await push({
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/traces/s1-login.zip'
    )
  })

  it('links an absolute artifact path relative to its manifest directory', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = path.join(RUN_DIR, 'traces/s1-login.zip')
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/traces/s1-login.zip'
    )
  })

  it('percent-encodes reserved characters in the artifact path', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = 'traces/s1 #2.zip'
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: new Map([
        [path.join(RUN_DIR, 'traces', 's1 #2.zip'), await zipOf(loginEvents)]
      ]),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]).toBe(
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
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(byName(spans, 'logs in')).toBeDefined()
    expect(warnings).toHaveLength(0)
  })

  it('links no artifact URL for a zip outside the manifest directory and warns', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = '../elsewhere/s1.zip'
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: new Map([
        [path.resolve(RUN_DIR, '../elsewhere/s1.zip'), await zipOf(loginEvents)]
      ]),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(
      byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]
    ).toBeUndefined()
    expect(warnings).toHaveLength(2)
    expect(warnings).toEqual([
      expect.stringContaining('no artifact URL'),
      expect.stringContaining('the zip is outside the manifest directory')
    ])
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
          attempt: 0
        },
        {
          uid: 'uid-other',
          title: 'other',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0
        }
      ]
    })
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(spans.map((span) => span.name).sort()).toEqual(['logs in', 'other'])
    expect(spans.every((span) => span.parentSpanContext === undefined)).toBe(
      true
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("record with traceGranularity:'test'")
  })

  it('skips the trace of tests sharing a spec-scope zip keyed by its spec file and warns', async () => {
    const manifest = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/s1-login.zip',
          key: 'specs/login.spec.ts',
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
          attempt: 0
        },
        {
          uid: 'uid-other',
          title: 'other',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0
        }
      ]
    })
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(spans.map((span) => span.name).sort()).toEqual(['logs in', 'other'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("record with traceGranularity:'test'")
  })

  it('links a shared zip without reading it, with or without --trace-zips', async () => {
    const shared = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/session.zip',
          testUids: ['uid-login', 'uid-other'],
          retained: true
        }
      ],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0
        },
        {
          uid: 'uid-other',
          title: 'other',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0
        }
      ]
    })
    for (const traceZips of [false, true]) {
      const { spans } = await push({
        manifests: [{ file: MANIFEST_FILE, manifest: shared }],
        artifactBaseUrl: 'https://bucket.example/run-1',
        traceZips
      })
      expect(
        spans.map((span) => span.attributes[attr.ATTR_ARTIFACT_URL])
      ).toEqual([
        'https://bucket.example/run-1/traces/session.zip',
        'https://bucket.example/run-1/traces/session.zip'
      ])
    }
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
    const { spans } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: manifestOf() },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: second
        }
      ]
    })
    const roots = [
      ...rootsNamed(spans, 'logs in'),
      ...rootsNamed(spans, 'other')
    ]
    expect(roots).toHaveLength(2)
    expect(
      new Set(roots.map((root) => root.attributes[attr.ATTR_RUN_ID]))
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
    manifestVersion: ARTIFACTS_MANIFEST_VERSION,
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
    const { spans, warnings } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: retriedManifest(keyedArtifacts) }
      ],
      zips: await retryZips(),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(warnings).toEqual([])
    const root = byName(spans, RETRIED_TITLE)
    expect(root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBe(
      attr.TEST_CASE_RESULT_STATUS_PASS
    )
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(root.attributes[attr.ATTR_FAILED_ACTION]).toBeUndefined()
    expect(root.attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/b-retry1/trace.zip'
    )
    expect(root.status.code).not.toBe(SpanStatusCode.ERROR)
  })

  it('links the keyless zip of the final attempt folder when the manifest has no keys', async () => {
    const unkeyed: Manifest['artifacts'] = keyedArtifacts.map(
      ({ path: artifactPath, testUids, kind, retained }) => ({
        kind,
        path: artifactPath,
        testUids,
        retained
      })
    )
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: retriedManifest(unkeyed) }],
      zips: await retryZips(),
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(
      byName(spans, RETRIED_TITLE).attributes[attr.ATTR_ERROR_MESSAGE]
    ).toBeUndefined()
    expect(
      byName(spans, RETRIED_TITLE).attributes[attr.ATTR_ARTIFACT_URL]
    ).toBe('https://bucket.example/run-1/b-retry1/trace.zip')
  })

  it("puts the final attempt's zip under the final root alone", async () => {
    const manifest = retriedManifest(keyedArtifacts, {
      attempts: [
        attemptRecord(0, 'failed', '000000000000aaa1'),
        finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2')
      ]
    })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: await retryZips()
    })
    const childrenOf = (spanId: string) =>
      spans
        .filter((span) => span.parentSpanContext?.spanId === spanId)
        .map((span) => span.name)
    const [first, final] = rootsNamed(spans, RETRIED_TITLE)
    expect(childrenOf(first.spanContext().spanId)).toEqual([])
    expect(childrenOf(final.spanContext().spanId)).toEqual(['Login'])
  })

  it('never stands an earlier attempt zip in for a final attempt that has none', async () => {
    const firstOnly: Manifest['artifacts'] = [keyedArtifacts[0]]
    const { spans, warnings } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: retriedManifest(firstOnly) }
      ],
      zips: await retryZips()
    })
    expect(warnings).toEqual([])
    expect(spans.map((span) => span.name)).toEqual([RETRIED_TITLE])
    const root = byName(spans, RETRIED_TITLE)
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(root.attributes[attr.ATTR_ARTIFACT_URL]).toBeUndefined()
    expect(root.attributes[attr.ATTR_TIME_SOURCE]).toBe(
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
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const root = byName(spans, 'logs in')
    expect(toMs(root.endTime)).toBe(EPOCH_2025 + 9000)
    expect(root.attributes[attr.ATTR_DURATION_MS]).toBe(8500)
    expect(root.attributes[attr.ATTR_ERROR_MESSAGE]).toBe('framework says no')
    expect(root.attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_MANIFEST
    )
    expect(toMs(root.startTime)).toBe(EPOCH_2025 + 500)
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
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(byName(spans, 'logs in').attributes[attr.ATTR_DURATION_MS]).toBe(
      8000
    )
  })

  it('starts a test with no zip and no manifest timing at the manifest file mtime', async () => {
    const { spans } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: manifestOf({ artifacts: [] }) }
      ]
    })
    const root = byName(spans, 'logs in')
    expect(toMs(root.startTime)).toBe(MTIME_MS)
    expect(root.attributes[attr.ATTR_TIME_SOURCE]).toBe(
      attr.TIME_SOURCE_MANIFEST_FILE
    )
  })

  it('names the trace as the source when the manifest gives a start but no end', async () => {
    const startOnly = (artifacts: Manifest['artifacts']) => {
      const record = finalRecord(0, 'failed', 'c0ffee0123456789')
      delete record.endTime
      return stampedManifest([record], { artifacts })
    }
    const timing = async (manifest: Manifest) => {
      const { spans } = await push({
        manifests: [{ file: MANIFEST_FILE, manifest }]
      })
      const root = byName(spans, 'logs in')
      return [
        root.attributes[attr.ATTR_TIME_SOURCE],
        root.attributes[attr.ATTR_DURATION_MS]
      ]
    }
    expect(await timing(startOnly(manifestOf().artifacts))).toEqual([
      attr.TIME_SOURCE_TRACE,
      600
    ])
    expect(await timing(startOnly([]))).toEqual([
      attr.TIME_SOURCE_MANIFEST,
      undefined
    ])
  })

  it('stamps trace-derived roots with trace time', async () => {
    const { spans } = await push()
    const root = byName(spans, 'logs in')
    expect(toMs(root.startTime)).toBe(EPOCH_2025 + 1000)
    expect(root.attributes[attr.ATTR_TIME_SOURCE]).toBe(attr.TIME_SOURCE_TRACE)
  })
})

describe('pushRun error message', () => {
  it('caps the failure message it pushes', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'uid-long',
          title: 'long failure',
          specFile: 'specs/a.spec.ts',
          state: 'failed',
          attempt: 0,
          endTime: EPOCH_2025,
          error: 'x'.repeat(10_000)
        }
      ]
    })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    expect(
      byName(spans, 'long failure').attributes[attr.ATTR_ERROR_MESSAGE]
    ).toBe(`${'x'.repeat(4096)}…`)
  })
})

describe('pushRun export failure', () => {
  const threeTests = () =>
    manifestOf({
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

  it('flushes once for the whole run, so the batch processors batch', async () => {
    let flushes = 0
    await push({
      manifests: [{ file: MANIFEST_FILE, manifest: threeTests() }],
      flush: async () => {
        flushes++
      }
    })
    expect(flushes).toBe(1)
  })

  it('names the run size when the flush fails', async () => {
    await expect(
      push({
        manifests: [{ file: MANIFEST_FILE, manifest: threeTests() }],
        flush: async () => {
          throw new Error('collector unreachable')
        }
      })
    ).rejects.toThrow(
      'export failed: 0 span(s) reached the collector, 0 emitted span(s) did not: collector unreachable'
    )
  })

  it('names the tests left unsent when a mid-run flush fails', async () => {
    let flushes = 0
    await expect(
      push({
        manifests: [{ file: MANIFEST_FILE, manifest: threeTests() }],
        pendingSpans: () => 5000,
        flush: async () => {
          if (++flushes > 1) {
            throw new Error('collector unreachable')
          }
        }
      })
    ).rejects.toThrow(
      'export failed: 0 span(s) reached the collector, 5000 emitted span(s) did not, and tests 3..3 were not sent: collector unreachable'
    )
  })
})

describe('pushRun unreadable zips', () => {
  it('warns about every unreadable zip and still pushes every record', async () => {
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
    const { spans, warnings } = await push({
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
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain(ZIP_PATH)
    expect(warnings[1]).toContain(path.join(RUN_DIR, 'traces', 'bad.zip'))
    expect(rootsNamed(spans, 'logs in')).toHaveLength(2)
  })
})

const TRACE_A = '0af7651916cd43dd8448eb211c80319c'
const TRACE_B = '4bf92f3577b34da6a3ce929d0e0e4736'
const PARENT_SPAN = '1111222233334444'
// Without TRACEPARENT the writer mints each attempt its own trace; a fixture sharing one passes a parent's traceId.
const attemptRecord = (
  attempt: number,
  state: TestAttemptRecord['state'],
  spanId: string,
  traceId = attempt === 0 ? TRACE_A : TRACE_B
): TestAttemptRecord => ({
  attempt,
  state,
  startTime: EPOCH_2025 + attempt * 1000,
  endTime: EPOCH_2025 + attempt * 1000 + 500,
  traceId,
  spanId
})
const finalRecord = (
  ...args: Parameters<typeof attemptRecord>
): TestAttemptRecord => ({ ...attemptRecord(...args), final: true })

const stampedManifest = (
  attempts: TestAttemptRecord[],
  overrides: Partial<Manifest> = {}
): Manifest =>
  manifestOf({
    artifacts: [],
    tests: [
      {
        uid: 'uid-login',
        title: 'logs in',
        specFile: 'specs/login.spec.ts',
        state: 'failed',
        attempt: attempts[attempts.length - 1].attempt,
        attempts
      }
    ],
    ...overrides
  })

const rootsNamed = (spans: ReadableSpan[], name: string): ReadableSpan[] =>
  spans.filter((span) => span.name === name)

describe('pushRun across specFileRetries workers', () => {
  const worker = (
    sessionId: string,
    state: 'failed' | 'passed',
    spanId: string,
    traceId: string,
    offsetMs: number
  ): Manifest =>
    manifestOf({
      sessionId,
      artifacts: [],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state,
          attempt: 0,
          error: state === 'failed' ? 'boom' : undefined,
          attempts: [
            {
              ...finalRecord(0, state, spanId, traceId),
              startTime: EPOCH_2025 + offsetMs,
              endTime: EPOCH_2025 + offsetMs + 500
            }
          ]
        }
      ]
    })

  const pushWorkers = (manifests: Manifest[]) =>
    push({
      manifests: manifests.map((manifest) => ({
        file: path.join(
          RUN_DIR,
          `devtools-artifacts-${manifest.sessionId}.json`
        ),
        manifest
      })),
      traceZips: false
    })
  const finalsBySpan = (spans: ReadableSpan[]) =>
    Object.fromEntries(
      rootsNamed(spans, 'logs in').map((root) => [
        root.spanContext().spanId,
        root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT]
      ])
    )

  it('keeps both finals of overlapping workers, such as two browsers', async () => {
    const chrome = worker('s1', 'failed', '000000000000aaa1', TRACE_A, 0)
    const firefox = worker('s2', 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B, 200)
    const { spans } = await pushWorkers([chrome, firefox])
    expect(finalsBySpan(spans)).toEqual({
      '000000000000aaa1': true,
      bbbbbbbbbbbbbbb2: true
    })
  })

  it('keeps a passed final that a later worker ran after', async () => {
    const first = worker('s1', 'passed', '000000000000aaa1', TRACE_A, 0)
    const second = worker('s2', 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B, 10_000)
    const { spans } = await pushWorkers([first, second])
    expect(finalsBySpan(spans)).toEqual({
      '000000000000aaa1': true,
      bbbbbbbbbbbbbbb2: true
    })
  })

  it('keeps a failed Chrome final that Firefox ran after', async () => {
    const chrome = {
      ...worker('s1', 'failed', '000000000000aaa1', TRACE_A, 0),
      browserName: 'chrome'
    }
    const firefox = {
      ...worker('s2', 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B, 10_000),
      browserName: 'firefox'
    }
    const { spans } = await pushWorkers([chrome, firefox])
    expect(finalsBySpan(spans)).toEqual({
      '000000000000aaa1': true,
      bbbbbbbbbbbbbbb2: true
    })
  })

  it("keeps only the later worker's root final", async () => {
    const first = {
      ...worker('s1', 'failed', '000000000000aaa1', TRACE_A, 0),
      browserName: 'chrome'
    }
    const retry = {
      ...worker('s2', 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B, 10_000),
      browserName: 'chrome'
    }
    for (const order of [
      [first, retry],
      [retry, first]
    ]) {
      const { spans } = await push({
        manifests: order.map((manifest) => ({
          file: path.join(
            RUN_DIR,
            `devtools-artifacts-${manifest.sessionId}.json`
          ),
          manifest
        })),
        traceZips: false
      })
      const roots = rootsNamed(spans, 'logs in').map((root) => [
        root.spanContext().spanId,
        root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT],
        root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS],
        root.attributes[attr.ATTR_ERROR_MESSAGE]
      ])
      expect(roots).toEqual(
        expect.arrayContaining([
          [
            '000000000000aaa1',
            false,
            attr.TEST_CASE_RESULT_STATUS_FAIL,
            'boom'
          ],
          [
            'bbbbbbbbbbbbbbb2',
            true,
            attr.TEST_CASE_RESULT_STATUS_PASS,
            undefined
          ]
        ])
      )
      expect(roots).toHaveLength(2)
    }
  })

  it("links the superseded worker's retained zip from its own root", async () => {
    const first = worker('s1', 'failed', '000000000000aaa1', TRACE_A, 0)
    first.artifacts = [
      {
        kind: 'trace',
        path: 'traces/s1-login.zip',
        key: 'uid-login',
        testUids: ['uid-login'],
        retained: true
      }
    ]
    const retry = worker('s2', 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B, 10_000)
    retry.artifacts = [
      {
        kind: 'trace',
        path: 'traces/s2-login.zip',
        key: 'uid-login',
        testUids: ['uid-login'],
        retained: false
      }
    ]
    const { spans } = await push({
      manifests: [first, retry].map((manifest) => ({
        file: path.join(
          RUN_DIR,
          `devtools-artifacts-${manifest.sessionId}.json`
        ),
        manifest
      })),
      traceZips: false,
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    const urls = Object.fromEntries(
      rootsNamed(spans, 'logs in').map((root) => [
        root.spanContext().spanId,
        root.attributes[attr.ATTR_ARTIFACT_URL]
      ])
    )
    expect(urls).toEqual({
      '000000000000aaa1': 'https://bucket.example/run-1/traces/s1-login.zip',
      bbbbbbbbbbbbbbb2: undefined
    })
  })
})

describe('pushRun stamped ids', () => {
  it('roots each attempt of a run without TRACEPARENT in its own trace with its stamped ids', async () => {
    const manifest = stampedManifest([
      attemptRecord(0, 'failed', '000000000000aaa1'),
      finalRecord(1, 'failed', 'bbbbbbbbbbbbbbb2')
    ])
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    const roots = rootsNamed(spans, 'logs in')
    expect(roots.map((root) => root.spanContext().spanId)).toEqual([
      '000000000000aaa1',
      'bbbbbbbbbbbbbbb2'
    ])
    expect(roots.map((root) => root.spanContext().traceId)).toEqual([
      TRACE_A,
      TRACE_B
    ])
    expect(roots.map((root) => root.parentSpanContext)).toEqual([
      undefined,
      undefined
    ])
    expect(
      roots.map((root) => [
        root.attributes[attr.ATTR_TEST_ATTEMPT],
        root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT]
      ])
    ).toEqual([
      [0, false],
      [1, true]
    ])
    expect(roots.map((root) => root.status.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.ERROR
    ])
    expect(roots[1].attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
    expect(toMs(roots[0].startTime)).toBe(EPOCH_2025)
    expect(toMs(roots[1].endTime)).toBe(EPOCH_2025 + 1500)
  })

  it('pushes the same ids, children included, on every push', async () => {
    const manifest = stampedManifest(
      [finalRecord(0, 'failed', 'c0ffee0123456789')],
      {
        artifacts: [
          {
            kind: 'trace',
            path: 'traces/s1-login.zip',
            testUids: ['uid-login'],
            retained: true
          }
        ]
      }
    )
    const ids = async () =>
      (await push({ manifests: [{ file: MANIFEST_FILE, manifest }] })).spans
        .map((span) => `${span.name}:${span.spanContext().spanId}`)
        .sort()
    const first = await ids()
    expect(first.length).toBeGreaterThan(1)
    expect(await ids()).toEqual(first)
  })

  it('gives every span of a nested-group tree with a polled wait its own id, and the same ids on a re-push', async () => {
    const before = (
      callId: string,
      startTime: number,
      method: string,
      parentId?: string
    ) => ({
      type: 'before',
      callId,
      startTime,
      class: method === 'tracingGroup' ? 'Tracing' : 'Element',
      method,
      pageId: 'p',
      params: {},
      title: callId,
      apiName: method,
      ...(parentId ? { parentId } : {})
    })
    const after = (callId: string, endTime: number) => ({
      type: 'after',
      callId,
      endTime
    })
    const events = [
      contextOptions,
      before('feature', 1000, 'tracingGroup'),
      before('scenario', 1010, 'tracingGroup', 'feature'),
      before('wait', 1020, 'waitForDisplayed', 'scenario'),
      before('poll-1', 1030, 'isDisplayed', 'wait'),
      after('poll-1', 1040),
      before('poll-2', 1050, 'isDisplayed', 'wait'),
      after('poll-2', 1060),
      after('wait', 1070),
      after('scenario', 1080),
      before('click', 1090, 'click', 'feature'),
      after('click', 1100),
      after('feature', 1110)
    ]
    const manifest = stampedManifest(
      [finalRecord(0, 'passed', 'c0ffee0123456789')],
      {
        artifacts: [
          {
            kind: 'trace',
            path: 'traces/s1-login.zip',
            testUids: ['uid-login'],
            retained: true
          }
        ]
      }
    )
    const zips = new Map([[ZIP_PATH, await zipOf(events)]])
    const ids = async () =>
      Object.fromEntries(
        (
          await push({ manifests: [{ file: MANIFEST_FILE, manifest }], zips })
        ).spans.map((span) => [span.name, span.spanContext().spanId])
      )
    const first = await ids()
    expect(Object.keys(first).sort()).toEqual(
      [
        'click',
        'feature',
        'logs in',
        'poll-1',
        'poll-2',
        'scenario',
        'wait'
      ].sort()
    )
    expect(new Set(Object.values(first)).size).toBe(7)
    expect(await ids()).toEqual(first)
  })

  it('derives each action span id from its root and ordinal under --trace-zips', async () => {
    const manifest = stampedManifest(
      [finalRecord(0, 'failed', 'c0ffee0123456789')],
      {
        artifacts: [
          {
            kind: 'trace',
            path: 'traces/s1-login.zip',
            testUids: ['uid-login'],
            retained: true
          }
        ]
      }
    )
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }]
    })
    const click = byName(spans, 'Element.click')
    expect(click.spanContext().spanId).toBe(
      derivedSpanId('c0ffee0123456789', '0')
    )
    expect(click.parentSpanContext?.spanId).toBe(
      byName(spans, 'Login').spanContext().spanId
    )
    expect(byName(spans, 'Login').parentSpanContext?.spanId).toBe(
      'c0ffee0123456789'
    )
  })

  it('links every root to the parent context from the manifest', async () => {
    const manifest = stampedManifest(
      [finalRecord(0, 'passed', '000000000000aaa1')],
      {
        parent: { traceId: TRACE_A, spanId: PARENT_SPAN, traceFlags: 1 }
      }
    )
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    const [root] = rootsNamed(spans, 'logs in')
    expect(root.spanContext().traceId).toBe(TRACE_A)
    expect(root.spanContext().spanId).toBe('000000000000aaa1')
    expect(root.parentSpanContext?.spanId).toBe(PARENT_SPAN)
    expect(warnings).toEqual([])
  })

  it('falls back to random ids and the test timing for a manifest from before attempts', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 0,
          startTime: EPOCH_2025 + 500,
          endTime: EPOCH_2025 + 900,
          durationMs: 400
        }
      ]
    })
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      zips: new Map(),
      traceZips: false
    })
    const [root] = rootsNamed(spans, 'logs in')
    expect(root.spanContext().spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(root.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(toMs(root.startTime)).toBe(EPOCH_2025 + 500)
    expect(toMs(root.endTime)).toBe(EPOCH_2025 + 900)
    expect(warnings).toEqual([])
  })
})

describe('pushRun opt-in zips', () => {
  it('never reads a zip without --trace-zips', async () => {
    const { spans, warnings } = await push({
      zips: new Map(),
      traceZips: false
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(warnings).toEqual([])
  })

  it('warns and skips the actions of a missing zip under --trace-zips without failing the push', async () => {
    const { spans, warnings } = await push({
      zips: new Map(),
      traceZips: true
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(ZIP_PATH)
    expect(warnings[0]).toContain('could not be read')
  })

  it('links the artifact URL without reading the zip', async () => {
    const { spans } = await push({
      traceZips: false,
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]).toBe(
      'https://bucket.example/run-1/traces/s1-login.zip'
    )
  })

  it('pushes a retained:false manifest and links no zip that was dropped', async () => {
    const manifest = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/s1-login.zip',
          testUids: ['uid-login'],
          retained: false
        }
      ]
    })
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false,
      artifactBaseUrl: 'https://bucket.example/run-1'
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(
      byName(spans, 'logs in').attributes[attr.ATTR_ARTIFACT_URL]
    ).toBeUndefined()
    expect(warnings).toEqual([])
  })
})

describe('pushRun final attempt marker', () => {
  const failThenPass = (): Manifest =>
    manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 1,
          attempts: [
            attemptRecord(0, 'failed', '000000000000aaa1'),
            finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2')
          ]
        }
      ]
    })

  it('marks only the root of the final attempt', async () => {
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: failThenPass() }],
      traceZips: false
    })
    const roots = rootsNamed(spans, 'logs in')
    expect(
      roots.map((root) => [
        root.attributes[attr.ATTR_TEST_ATTEMPT],
        root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT]
      ])
    ).toEqual([
      [0, false],
      [1, true]
    ])
  })

  it('times every root from its own attempt record when the test carries no timing', async () => {
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: failThenPass() }],
      traceZips: false
    })
    expect(
      rootsNamed(spans, 'logs in').map((root) => [
        root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT],
        root.attributes[attr.ATTR_DURATION_MS],
        root.attributes[attr.ATTR_TIME_SOURCE]
      ])
    ).toEqual([
      [false, 500, attr.TIME_SOURCE_MANIFEST],
      [true, 500, attr.TIME_SOURCE_MANIFEST]
    ])
  })

  it("labels the final root with its own record's attempt", async () => {
    const manifest = failThenPass()
    manifest.tests[0].attempt = 0
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    const final = rootsNamed(spans, 'logs in').find(
      (root) => root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT] === true
    )
    expect(final?.attributes[attr.ATTR_TEST_ATTEMPT]).toBe(1)
  })

  it('reports each root with its own attempt status', async () => {
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: failThenPass() }],
      traceZips: false
    })
    expect(
      rootsNamed(spans, 'logs in').map((root) => [
        root.attributes[attr.ATTR_TEST_ATTEMPT],
        root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]
      ])
    ).toEqual([
      [0, attr.TEST_CASE_RESULT_STATUS_FAIL],
      [1, attr.TEST_CASE_RESULT_STATUS_PASS]
    ])
  })

  // The final root's error message and failed action are read from the test, so its status must be too.
  it("gives the final root the test's status over its record's", async () => {
    const manifest = failThenPass()
    manifest.tests[0].attempts = [
      attemptRecord(0, 'failed', '000000000000aaa1'),
      finalRecord(1, 'failed', 'bbbbbbbbbbbbbbb2')
    ]
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    expect(
      rootsNamed(spans, 'logs in').map(
        (root) => root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]
      )
    ).toEqual([
      attr.TEST_CASE_RESULT_STATUS_FAIL,
      attr.TEST_CASE_RESULT_STATUS_PASS
    ])
  })

  it('marks the record the writer stamped final', async () => {
    const manifest = manifestOf({
      artifacts: [],
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'failed',
          attempt: 1,
          attempts: [
            { ...attemptRecord(0, 'failed', '000000000000aaa1'), final: true },
            attemptRecord(1, 'failed', 'bbbbbbbbbbbbbbb2')
          ]
        }
      ]
    })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    const finals = rootsNamed(spans, 'logs in').filter(
      (root) => root.attributes[attr.ATTR_TEST_FINAL_ATTEMPT] === true
    )
    expect(finals).toHaveLength(1)
    expect(finals[0].spanContext().spanId).toBe('000000000000aaa1')
  })
})

describe('planPush unreadable zips', () => {
  const emitAndListUnreadable = async (plan: PushPlan): Promise<string[]> => {
    await plan.emit({
      tracer: new TracerProvider().getTracer('test'),
      ids: new PinnedIdGenerator(),
      flush: async () => {},
      pendingSpans: () => 0,
      exportedSpans: () => 0
    })
    return plan.unreadable()
  }

  const planOf = (
    manifest: Manifest,
    zips: Map<string, Uint8Array>,
    traceZips = true
  ) =>
    planPush({
      manifests: [{ file: MANIFEST_FILE, manifest, mtimeMs: MTIME_MS }],
      runId: 'run-1',
      traceZips,
      ignoreParentSampling: false,
      consoleMessages: false,
      realpath: (target) => target,
      loadZip: (zipPath) => {
        const zip = zips.get(zipPath)
        if (!zip) {
          throw new Error(`no fixture for ${zipPath}`)
        }
        return zip
      },
      warn: () => {}
    })

  it('lists a zip requested under --trace-zips that cannot be parsed', async () => {
    const plan = planOf(
      manifestOf(),
      new Map([[ZIP_PATH, new Uint8Array([1, 2, 3])]])
    )
    expect(await emitAndListUnreadable(plan)).toEqual([ZIP_PATH])
  })

  it('lists nothing when every requested zip reads', async () => {
    const plan = planOf(
      manifestOf(),
      new Map([[ZIP_PATH, await zipOf(loginEvents)]])
    )
    expect(await emitAndListUnreadable(plan)).toEqual([])
  })

  it('refuses a zip outside the manifest directory without reading it', async () => {
    const manifest = manifestOf()
    manifest.artifacts[0].path = '../elsewhere/s1.zip'
    const outside = path.resolve(RUN_DIR, '../elsewhere/s1.zip')
    const reads: string[] = []
    const plan = planPush({
      manifests: [{ file: MANIFEST_FILE, manifest, mtimeMs: MTIME_MS }],
      traceZips: true,
      ignoreParentSampling: false,
      consoleMessages: false,
      realpath: (target) => target,
      loadZip: (zipPath) => {
        reads.push(zipPath)
        return new Uint8Array([1])
      },
      warn: () => {}
    })
    expect(await emitAndListUnreadable(plan)).toEqual([outside])
    expect(reads).toEqual([])
  })

  it('never reads a dropped zip, so a corrupt one does not count', async () => {
    const manifest = manifestOf({
      artifacts: [
        {
          kind: 'trace',
          path: 'traces/s1-login.zip',
          testUids: ['uid-login'],
          retained: false
        }
      ]
    })
    const plan = planOf(manifest, new Map([[ZIP_PATH, new Uint8Array([1])]]))
    expect(await emitAndListUnreadable(plan)).toEqual([])
  })
})

describe('pushRun manifest context', () => {
  const contextOf = (overrides: Partial<Manifest>) =>
    manifestOf({ artifacts: [], ...overrides })
  const rootAttributes = async (manifest: Manifest) => {
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    return byName(spans, 'logs in').attributes
  }
  const withSpec = (specFile: string): Manifest =>
    contextOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile,
          state: 'failed',
          attempt: 0
        }
      ]
    })

  it('stamps session, browser and uid, and the spec file as the suite name', async () => {
    const attributes = await rootAttributes(
      contextOf({
        browserName: 'chrome',
        browserVersion: '120',
        platformName: 'linux',
        tests: [
          {
            uid: 'uid-login',
            title: 'logs in',
            specFile: '/repo/test/login.spec.ts',
            state: 'failed',
            attempt: 0
          }
        ]
      })
    )
    expect(attributes[attr.ATTR_SESSION_ID]).toBe('s1')
    expect(attributes[attr.ATTR_DEVTOOLS_TEST_UID]).toBe('uid-login')
    expect(attributes[attr.ATTR_DEVTOOLS_BROWSER_NAME]).toBe('chrome')
    expect(attributes[attr.ATTR_DEVTOOLS_BROWSER_VERSION]).toBe('120')
    expect(attributes[attr.ATTR_DEVTOOLS_PLATFORM_NAME]).toBe('linux')
    expect(attributes[attr.ATTR_TEST_SUITE_NAME]).toBe(
      '/repo/test/login.spec.ts'
    )
  })

  it('keeps the spec file as recorded', async () => {
    const attributes = await rootAttributes(withSpec('/repo/test/a.spec.ts'))
    expect(attributes[attr.ATTR_TEST_SUITE_NAME]).toBe('/repo/test/a.spec.ts')
  })

  it('keeps a Windows spec file as recorded', async () => {
    const attributes = await rootAttributes(
      withSpec('C:\\repo\\test\\a.spec.ts')
    )
    expect(attributes[attr.ATTR_TEST_SUITE_NAME]).toBe(
      'C:\\repo\\test\\a.spec.ts'
    )
  })

  it('keeps a spec outside any manifest directory as recorded', async () => {
    const attributes = await rootAttributes(withSpec('/other/a.spec.ts'))
    expect(attributes[attr.ATTR_TEST_SUITE_NAME]).toBe('/other/a.spec.ts')
  })

  it('pushes a test with no recorded outcome without a status', async () => {
    const { spans, warnings } = await push({
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: contextOf({
            tests: [
              {
                uid: 'uid-login',
                title: 'logs in',
                specFile: 'specs/login.spec.ts',
                attempt: 0
              }
            ]
          })
        }
      ],
      traceZips: false
    })
    const root = byName(spans, 'logs in')
    expect(root.attributes[attr.ATTR_TEST_CASE_RESULT_STATUS]).toBeUndefined()
    expect(root.status.code).toBe(SpanStatusCode.UNSET)
    expect(warnings).toEqual([
      `1 test(s) in ${MANIFEST_FILE} have no recorded outcome and are pushed without a status`
    ])
  })

  it('a failed earlier attempt carries its own error', async () => {
    const manifest = contextOf({
      tests: [
        {
          uid: 'uid-login',
          title: 'logs in',
          specFile: 'specs/login.spec.ts',
          state: 'passed',
          attempt: 1,
          attempts: [
            {
              ...attemptRecord(0, 'failed', '000000000000aaa1'),
              error: 'first boom'
            },
            finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2')
          ]
        }
      ]
    })
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    const [first, final] = rootsNamed(spans, 'logs in')
    expect(first.attributes[attr.ATTR_ERROR_MESSAGE]).toBe('first boom')
    expect(first.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'first boom'
    })
    expect(final.attributes[attr.ATTR_ERROR_MESSAGE]).toBeUndefined()
  })
})

describe('pushRun trace per test', () => {
  const sameTrace = (): Manifest =>
    stampedManifest([
      attemptRecord(0, 'failed', '000000000000aaa1', TRACE_A),
      finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2', TRACE_A)
    ])

  it('roots every attempt of a test in the trace the manifest names, with no run root span', async () => {
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest: sameTrace() }],
      traceZips: false
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in', 'logs in'])
    const attempts = rootsNamed(spans, 'logs in')
    expect(attempts.map((attempt) => attempt.spanContext())).toEqual([
      expect.objectContaining({ traceId: TRACE_A, spanId: '000000000000aaa1' }),
      expect.objectContaining({ traceId: TRACE_A, spanId: 'bbbbbbbbbbbbbbb2' })
    ])
    expect(attempts.map((attempt) => attempt.parentSpanContext)).toEqual([
      undefined,
      undefined
    ])
  })

  it('parents the attempts of a manifest with a TRACEPARENT under that parent and adds no run span', async () => {
    const manifest = stampedManifest(
      [finalRecord(0, 'passed', '000000000000aaa1', TRACE_A)],
      { parent: { traceId: TRACE_A, spanId: PARENT_SPAN, traceFlags: 1 } }
    )
    const { spans } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(byName(spans, 'logs in').parentSpanContext?.spanId).toBe(PARENT_SPAN)
  })

  it('pushes nothing of a manifest recorded under an unsampled TRACEPARENT and warns once', async () => {
    const manifest = stampedManifest(
      [finalRecord(0, 'passed', '000000000000aaa1', TRACE_A)],
      { parent: { traceId: TRACE_A, spanId: PARENT_SPAN, traceFlags: 0 } }
    )
    const { spans, warnings } = await push({
      manifests: [{ file: MANIFEST_FILE, manifest }],
      traceZips: false
    })
    expect(spans).toEqual([])
    expect(warnings).toEqual([
      `${MANIFEST_FILE} was recorded under an unsampled TRACEPARENT, so its 1 test(s) were not pushed; pass --ignore-parent-sampling to push them anyway`
    ])
  })

  it('names each manifest run by its own runId, else its sessionId with a warning', () => {
    const warnings: string[] = []
    const plan = planPush({
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: manifestOf({ runId: 'run-9' }),
          mtimeMs: MTIME_MS
        },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: manifestOf({ sessionId: 's2' }),
          mtimeMs: MTIME_MS
        }
      ],
      traceZips: false,
      ignoreParentSampling: false,
      consoleMessages: false,
      realpath: (target) => target,
      loadZip: () => new Uint8Array(),
      warn: (message) => warnings.push(message)
    })
    expect(plan.runIds).toEqual(['run-9', 's2'])
    expect(warnings).toEqual([
      `${path.join(RUN_DIR, 'devtools-artifacts-s2.json')} has no runId, so its run is named by its sessionId s2; pass --run-id to group it with other manifests`
    ])
  })

  it('names every manifest with the --run-id override', () => {
    const plan = planPush({
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: manifestOf({ runId: 'run-9' }),
          mtimeMs: MTIME_MS
        }
      ],
      runId: 'ci-42',
      traceZips: false,
      ignoreParentSampling: false,
      consoleMessages: false,
      realpath: (target) => target,
      loadZip: () => new Uint8Array(),
      warn: () => {}
    })
    expect(plan.runIds).toEqual(['ci-42'])
  })
})

describe('pushRun superseded finals across skipped manifests', () => {
  it('lets a final skipped for an unsampled TRACEPARENT supersede the failed final it retried', async () => {
    const failed = stampedManifest([
      finalRecord(0, 'failed', '000000000000aaa1', TRACE_A)
    ])
    const retried = stampedManifest(
      [finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B)],
      { parent: { traceId: TRACE_A, spanId: PARENT_SPAN, traceFlags: 0 } }
    )
    const { spans, warnings } = await push({
      manifests: [
        { file: MANIFEST_FILE, manifest: failed },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-retry.json'),
          manifest: retried
        }
      ],
      traceZips: false
    })
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes[attr.ATTR_TEST_FINAL_ATTEMPT]).toBe(false)
    expect(warnings).toEqual([
      `${path.join(RUN_DIR, 'devtools-artifacts-retry.json')} was recorded under an unsampled TRACEPARENT, so its 1 test(s) were not pushed; pass --ignore-parent-sampling to push them anyway`
    ])
  })
})

describe('pushRun superseded finals across runs', () => {
  it('keeps the final of a test that shares its uid with a test in another run', async () => {
    const failed = stampedManifest([
      finalRecord(0, 'failed', '000000000000aaa1', TRACE_A)
    ])
    const passed = stampedManifest([
      finalRecord(1, 'passed', 'bbbbbbbbbbbbbbb2', TRACE_B)
    ])
    const { spans } = await push({
      runId: null,
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: { ...failed, runId: 'run-a' }
        },
        {
          file: path.join(RUN_DIR, 'devtools-artifacts-s2.json'),
          manifest: { ...passed, sessionId: 's2', runId: 'run-b' }
        }
      ],
      traceZips: false
    })
    expect(
      spans.map((span) => span.attributes[attr.ATTR_TEST_FINAL_ATTEMPT])
    ).toEqual([true, true])
  })
})

describe('pushRun unsampled parent through the telemetry sampler', () => {
  const unsampledManifest = (): Manifest =>
    stampedManifest([finalRecord(0, 'passed', '000000000000aaa1', TRACE_A)], {
      parent: { traceId: TRACE_A, spanId: PARENT_SPAN, traceFlags: 0 }
    })

  async function pushThroughTelemetry(ignoreParentSampling: boolean) {
    const exporter = new InMemorySpanExporter()
    const telemetry = telemetryWith(
      new SimpleSpanProcessor({ exporter }),
      { pending: 0, exported: 0, oldestEndMs: undefined },
      {},
      ignoreParentSampling
    )
    const plan = planPush({
      manifests: [
        {
          file: MANIFEST_FILE,
          manifest: unsampledManifest(),
          mtimeMs: MTIME_MS
        }
      ],
      traceZips: false,
      ignoreParentSampling,
      consoleMessages: false,
      realpath: (target) => target,
      loadZip: () => new Uint8Array(),
      warn: () => {}
    })
    await plan.emit(telemetry)
    return exporter.getFinishedSpans()
  }

  it('emits an unsampled parent with --ignore-parent-sampling, sampled and parented to the CI span', async () => {
    const spans = await pushThroughTelemetry(true)
    expect(spans.map((span) => span.name)).toEqual(['logs in'])
    expect(spans[0].spanContext().traceFlags & TraceFlags.SAMPLED).toBe(
      TraceFlags.SAMPLED
    )
    expect(spans[0].parentSpanContext?.spanId).toBe(PARENT_SPAN)
  })

  it('emits nothing for an unsampled parent by default', async () => {
    expect(await pushThroughTelemetry(false)).toEqual([])
  })
})
