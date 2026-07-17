import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import type {
  TraceActionChild,
  TraceActionGroupNode
} from '@wdio/devtools-shared'
import { parseTraceZip } from '../src/trace-reader.js'
import { buildSources, stackToCallSource } from '../src/trace-reader-utils.js'
import type { BeforeEvent } from '../src/trace-reader-types.js'

function allGroups(children: TraceActionChild[]): TraceActionGroupNode[] {
  return children.flatMap((child) =>
    'group' in child ? [child.group, ...allGroups(child.group.children)] : []
  )
}

function commandIndices(children: TraceActionChild[]): number[] {
  return children.flatMap((child) =>
    'group' in child
      ? commandIndices(child.group.children)
      : [child.commandIndex]
  )
}

const SPEC_PATH = '/specs/login.ts'
const SPEC_SHA1 = createHash('sha1').update(SPEC_PATH).digest('hex')

const WALL_TIME = 1_000_000
const IMG1 = Buffer.from('frame-one').toString('base64')
const IMG2 = Buffer.from('frame-two').toString('base64')
const IMG3 = Buffer.from('frame-three').toString('base64')

const toNdjson = (events: object[]): Uint8Array =>
  strToU8(events.map((event) => JSON.stringify(event)).join('\n') + '\n')

// Build a trace.zip matching the writer's format (core/trace-exporter.ts)
// directly, so the reader is exercised without importing core (CLAUDE.md §2.2).
function fixtureZip(): Uint8Array {
  const events = [
    {
      type: 'context-options',
      wallTime: WALL_TIME,
      browserName: 'chrome',
      contextId: 'context@abcd1234',
      options: { viewport: { width: 1024, height: 768 } }
    },
    {
      type: 'before',
      callId: 'call@1',
      startTime: 0,
      class: 'Page',
      method: 'navigate',
      params: { url: 'https://example.com' }
    },
    { type: 'after', callId: 'call@1', endTime: 50, result: 'example.com' },
    {
      type: 'before',
      callId: 'call@2',
      startTime: 100,
      class: 'Element',
      method: 'fill',
      params: { selector: '#name', value: 'vishnu' },
      parentId: 'call@0'
    },
    { type: 'after', callId: 'call@2', endTime: 160 },
    {
      type: 'before',
      callId: 'call@0',
      startTime: 90,
      class: 'Tracing',
      method: 'tracingGroup',
      params: { name: 'my test' }
    },
    {
      type: 'before',
      callId: 'call@3',
      startTime: 200,
      class: 'Element',
      method: 'click',
      params: { selector: '#submit' },
      stack: [{ file: SPEC_PATH, line: 42, column: 0 }],
      parentId: 'call@0'
    },
    {
      type: 'after',
      callId: 'call@3',
      endTime: 260,
      error: { message: 'boom' }
    },
    { type: 'after', callId: 'call@0', endTime: 260 },
    {
      type: 'screencast-frame',
      pageId: 'page@abcd1234',
      sha1: 'page@abcd1234-0.jpeg',
      width: 1024,
      height: 768,
      timestamp: 0
    },
    {
      type: 'screencast-frame',
      pageId: 'page@abcd1234',
      sha1: 'page@abcd1234-160.jpeg',
      width: 1024,
      height: 768,
      timestamp: 160
    },
    {
      type: 'screencast-frame',
      pageId: 'page@abcd1234',
      sha1: 'page@abcd1234-260.jpeg',
      width: 1024,
      height: 768,
      timestamp: 260
    },
    {
      type: 'console',
      time: 120,
      pageId: 'page@abcd1234',
      messageType: 'warning',
      text: 'low disk',
      args: [{ preview: 'low disk', value: 'low disk' }],
      location: { url: '', lineNumber: 0, columnNumber: 0 }
    },
    { type: 'stdout', timestamp: 130, text: 'spec started', source: 'test' },
    { type: 'stderr', timestamp: 140, text: 'worker warning' }
  ]
  const networkEntry = {
    type: 'resource-snapshot',
    snapshot: {
      startedDateTime: new Date(WALL_TIME + 70).toISOString(),
      time: 20,
      request: {
        method: 'GET',
        url: 'https://example.com/api',
        headers: [{ name: 'Accept', value: '*/*' }]
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [{ name: 'content-type', value: 'application/json' }],
        content: { size: 123, mimeType: 'application/json' }
      }
    }
  }
  return zipSync({
    'trace.trace': toNdjson(events),
    'trace.network': strToU8(JSON.stringify(networkEntry)),
    'resources/page@abcd1234-0.jpeg': new Uint8Array(Buffer.from('frame-one')),
    'resources/page@abcd1234-160.jpeg': new Uint8Array(
      Buffer.from('frame-two')
    ),
    'resources/page@abcd1234-260.jpeg': new Uint8Array(
      Buffer.from('frame-three')
    ),
    [`resources/src@${SPEC_SHA1}.txt`]: strToU8('it("logs in", () => {})')
  })
}

describe('parseTraceZip', () => {
  it('reconstructs commands with canonical names and reversed args', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.commands.map((c) => c.command)).toEqual([
      'url',
      'setValue',
      'click'
    ])
    expect(trace.commands[0].args).toEqual(['https://example.com'])
    expect(trace.commands[1].args).toEqual(['#name', 'vishnu'])
    expect(trace.commands[2].args).toEqual(['#submit'])
    expect(trace.commands[2].error?.message).toBe('boom')
  })

  it('attaches the nearest frame screenshot to each command', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.commands[0].screenshot).toBe(IMG1)
    expect(trace.commands[1].screenshot).toBe(IMG2)
    expect(trace.commands[2].screenshot).toBe(IMG3)
  })

  it('rebuilds the frame filmstrip sorted by timestamp', () => {
    const { frames, startTime, duration } = parseTraceZip(fixtureZip())
    expect(frames.length).toBe(3)
    expect(frames[0].screenshot).toBe(IMG1)
    expect(frames.map((f) => f.timestamp)).toEqual(
      [...frames.map((f) => f.timestamp)].sort((a, b) => a - b)
    )
    expect(startTime).toBe(WALL_TIME)
    expect(duration).toBeGreaterThan(0)
  })

  it('reconstructs network requests from HAR entries', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.networkRequests).toHaveLength(1)
    const req = trace.networkRequests[0]
    expect(req.url).toBe('https://example.com/api')
    expect(req.method).toBe('GET')
    expect(req.status).toBe(200)
    expect(req.type).toBe('fetch')
    expect(req.size).toBe(123)
    expect(req.responseHeaders?.['content-type']).toBe('application/json')
  })

  it('recovers metadata and leaves zip-absent fields empty', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.metadata.viewport?.width).toBe(1024)
    expect(
      (trace.metadata.capabilities as { browserName: string }).browserName
    ).toBe('chrome')
    expect(trace.metadata.sessionId).toBe('abcd1234')
    expect(trace.mutations).toEqual([])
    expect(trace.suites).toEqual([])
  })

  it('restores DOM mutations from a trace.mutations stream, dropping the marker', () => {
    const mutations = [
      {
        type: 'childList',
        addedNodes: [{ tag: 'html' }],
        removedNodes: [],
        timestamp: 1000
      },
      {
        type: 'attributes',
        target: 'body',
        attributeName: 'class',
        addedNodes: [],
        removedNodes: [],
        timestamp: 1100
      }
    ]
    const zip = zipSync({
      'trace.trace': toNdjson([
        {
          type: 'context-options',
          wallTime: WALL_TIME,
          browserName: 'chrome',
          contextId: 'context@abcd1234',
          options: { viewport: { width: 1024, height: 768 } }
        }
      ]),
      'trace.mutations': toNdjson([
        ...mutations,
        { __truncated__: true, dropped: 7 }
      ])
    })
    const { trace } = parseTraceZip(zip)
    // Two mutations from three NDJSON lines proves the trailing truncation
    // marker was dropped rather than surfaced as a mutation.
    expect(trace.mutations).toHaveLength(2)
    expect(trace.mutations[0]).toMatchObject({ type: 'childList' })
    expect(trace.mutations[1]).toMatchObject({ target: 'body' })
  })

  it('reads transcript.md into the player payload when present', () => {
    const zip = zipSync({
      'trace.trace': toNdjson([
        {
          type: 'context-options',
          wallTime: WALL_TIME,
          browserName: 'chrome',
          contextId: 'context@abcd1234',
          options: { viewport: { width: 1024, height: 768 } }
        }
      ]),
      'transcript.md': strToU8('# Session\n\n1. Page.navigate("https://x")')
    })
    expect(parseTraceZip(zip).transcript).toContain('Page.navigate')
  })

  it('leaves transcript undefined when the zip carries none', () => {
    expect(parseTraceZip(fixtureZip()).transcript).toBeUndefined()
  })

  it('restores callSource and sources from stack frames + src resources', () => {
    const { trace } = parseTraceZip(fixtureZip())
    const click = trace.commands.find((c) => c.command === 'click')
    expect(click?.callSource).toBe(`${SPEC_PATH}:42`)
    expect(trace.commands.find((c) => c.command === 'url')?.callSource).toBe(
      undefined
    )
    expect(trace.sources).toEqual({
      [SPEC_PATH]: 'it("logs in", () => {})'
    })
  })

  it('restores the command result from the after event', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.commands.find((c) => c.command === 'url')?.result).toBe(
      'example.com'
    )
  })

  it('skips tracing group markers so the last command stays the last action', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.commands.some((c) => c.command === 'tracingGroup')).toBe(false)
    expect(trace.commands[trace.commands.length - 1].command).toBe('click')
  })

  it('nests parentId-linked commands under the tracing group node', () => {
    const { trace, groups } = parseTraceZip(fixtureZip())
    expect(groups).toBeDefined()
    // Root is chronological: url (start 0) before the group (start 90).
    expect(groups).toHaveLength(2)
    expect(groups?.[0]).toEqual({ commandIndex: 0 })
    expect(trace.commands[0].command).toBe('url')
    const [group] = allGroups(groups ?? [])
    expect(group.title).toBe('my test')
    expect(group.startTime).toBe(WALL_TIME + 90)
    expect(group.endTime).toBe(WALL_TIME + 260)
    const children = commandIndices(group.children)
    expect(children.map((i) => trace.commands[i].command)).toEqual([
      'setValue',
      'click'
    ])
  })

  it('marks the group failed when a child command errored', () => {
    const { groups } = parseTraceZip(fixtureZip())
    const [group] = allGroups(groups ?? [])
    expect(group.failed).toBe(true)
  })

  it('reconstructs console logs from console and stdio events', () => {
    const { trace } = parseTraceZip(fixtureZip())
    expect(trace.consoleLogs).toEqual([
      {
        type: 'warn',
        args: ['low disk'],
        timestamp: WALL_TIME + 120,
        source: 'browser'
      },
      {
        type: 'log',
        args: ['spec started'],
        timestamp: WALL_TIME + 130,
        source: 'test'
      },
      {
        type: 'error',
        args: ['worker warning'],
        timestamp: WALL_TIME + 140,
        source: 'terminal'
      }
    ])
  })
})

const FOREIGN_SPEC = '/specs/foreign.spec.ts'
const FOREIGN_SPEC_SHA1 = createHash('sha1').update(FOREIGN_SPEC).digest('hex')
const RUNNER_WALL = 2_000_000
const LIB_WALL = 2_000_400
// Both streams share one monotonic clock: wallTime - monotonicTime is equal.
const EPOCH_ANCHOR = RUNNER_WALL - 500
const FOREIGN_IMG_A = Buffer.from('foreign-frame-a').toString('base64')
const FOREIGN_IMG_B = Buffer.from('foreign-frame-b').toString('base64')

// Emulates a foreign tool's zip: a runner stream (`test.trace`) wrapping
// library calls, a per-context stream, monotonic timestamps, bare-sha1
// screencast refs, and a `.stacks` sidecar.
function foreignFixtureZip(): Uint8Array {
  const runnerEvents = [
    {
      type: 'context-options',
      origin: 'testRunner',
      wallTime: RUNNER_WALL,
      monotonicTime: 500,
      browserName: '',
      options: {}
    },
    {
      type: 'before',
      callId: 'hook@1',
      stepId: 'hook@1',
      startTime: 600,
      class: 'Test',
      method: 'hook',
      title: 'Before Hooks',
      params: {}
    },
    {
      type: 'before',
      callId: 'fixture@2',
      stepId: 'fixture@2',
      parentId: 'hook@1',
      startTime: 610,
      class: 'Test',
      method: 'fixture',
      title: 'Fixture "browser"',
      params: {}
    },
    {
      type: 'before',
      callId: 'step@3',
      stepId: 'step@3',
      parentId: 'fixture@2',
      startTime: 700,
      class: 'Test',
      method: 'step',
      title: 'Click "go"',
      params: {},
      stack: [{ file: FOREIGN_SPEC, line: 10, column: 5 }]
    },
    {
      type: 'before',
      callId: 'expect@5',
      stepId: 'expect@5',
      startTime: 950,
      class: 'Test',
      method: 'expect',
      title: 'Expect "toBeVisible"',
      params: {}
    },
    {
      type: 'after',
      callId: 'step@3',
      endTime: 760,
      error: { message: 'wrapped failure' }
    },
    { type: 'after', callId: 'fixture@2', endTime: 780 },
    { type: 'after', callId: 'hook@1', endTime: 800 },
    { type: 'after', callId: 'expect@5', endTime: 980 },
    { type: 'error', message: 'ignored non-action event' }
  ]
  const libraryEvents = [
    {
      type: 'context-options',
      origin: 'library',
      wallTime: LIB_WALL,
      monotonicTime: 900,
      browserName: 'chromium',
      contextId: 'browser-context@f00d',
      options: { viewport: { width: 800, height: 600 } }
    },
    {
      type: 'before',
      callId: 'call@10',
      stepId: 'step@3',
      startTime: 710,
      class: 'Frame',
      method: 'click',
      params: { selector: '#go' }
    },
    { type: 'after', callId: 'call@10', endTime: 750 },
    {
      type: 'before',
      callId: 'call@12',
      stepId: 'step@99',
      startTime: 800,
      class: 'Frame',
      method: 'fill',
      params: { selector: '#q', value: 'hi' }
    },
    {
      type: 'after',
      callId: 'call@12',
      endTime: 900,
      error: { message: 'nope' }
    },
    {
      type: 'screencast-frame',
      pageId: 'page@f00d',
      sha1: 'aaa111',
      width: 800,
      height: 600,
      timestamp: 720,
      frameSwapWallTime: EPOCH_ANCHOR + 720
    },
    {
      type: 'screencast-frame',
      pageId: 'page@f00d',
      sha1: 'bbb222',
      width: 800,
      height: 600,
      timestamp: 880,
      frameSwapWallTime: EPOCH_ANCHOR + 880
    },
    {
      type: 'console',
      messageType: 'warning',
      text: 'careful',
      args: [{ preview: 'careful', value: 'careful' }],
      time: 820,
      pageId: 'page@f00d'
    },
    { type: 'log', time: 830, message: 'ignored log event' },
    { type: 'frame-snapshot', snapshot: {} },
    { type: 'input', inputSnapshot: {} }
  ]
  const networkEntry = {
    type: 'resource-snapshot',
    snapshot: {
      startedDateTime: new Date(EPOCH_ANCHOR + 715).toISOString(),
      time: 30,
      request: {
        method: 'GET',
        url: 'https://x.dev/api',
        headers: []
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [],
        content: { size: 10, mimeType: 'text/html' }
      }
    }
  }
  const stacks = {
    files: [FOREIGN_SPEC],
    stacks: [
      [10, [[0, 10, 5, '']]],
      [12, [[0, 33, 7, '']]]
    ]
  }
  return zipSync({
    'test.trace': toNdjson(runnerEvents),
    '0-trace.trace': toNdjson(libraryEvents),
    '0-trace.network': strToU8(JSON.stringify(networkEntry)),
    '0-trace.stacks': strToU8(JSON.stringify(stacks)),
    'resources/aaa111.jpeg': new Uint8Array(Buffer.from('foreign-frame-a')),
    'resources/bbb222.png': new Uint8Array(Buffer.from('foreign-frame-b')),
    [`resources/src@${FOREIGN_SPEC_SHA1}.txt`]: strToU8('test("foreign")')
  })
}

describe('parseTraceZip with a foreign multi-stream zip', () => {
  it('merges streams, drops runner wrappers and container steps', () => {
    const { trace } = parseTraceZip(foreignFixtureZip())
    expect(trace.commands.map((c) => c.command)).toEqual([
      'click',
      'fill',
      'expect'
    ])
    expect(trace.commands[0].args).toEqual(['#go'])
    expect(trace.commands[0].title).toBe('Frame.click("#go")')
    expect(trace.commands[1].error?.message).toBe('nope')
    expect(trace.commands[2].title).toBe('Expect "toBeVisible"')
  })

  it('rebases monotonic timestamps onto the wall clock', () => {
    const { trace, frames, startTime, duration } =
      parseTraceZip(foreignFixtureZip())
    expect(startTime).toBe(RUNNER_WALL)
    expect(trace.commands[0].startTime).toBe(EPOCH_ANCHOR + 710)
    expect(trace.commands[0].timestamp).toBe(EPOCH_ANCHOR + 750)
    expect(frames.map((f) => f.timestamp)).toEqual([
      EPOCH_ANCHOR + 720,
      EPOCH_ANCHOR + 880
    ])
    expect(duration).toBe(EPOCH_ANCHOR + 980 - RUNNER_WALL)
  })

  it('resolves bare-sha1 screencast refs via image extension fallbacks', () => {
    const { frames, trace } = parseTraceZip(foreignFixtureZip())
    expect(frames.map((f) => f.screenshot)).toEqual([
      FOREIGN_IMG_A,
      FOREIGN_IMG_B
    ])
    expect(trace.commands[0].screenshot).toBe(FOREIGN_IMG_A)
  })

  it('merges network streams and console events, picks the browser context', () => {
    const { trace } = parseTraceZip(foreignFixtureZip())
    expect(trace.networkRequests).toHaveLength(1)
    expect(trace.networkRequests[0].url).toBe('https://x.dev/api')
    expect(trace.consoleLogs).toEqual([
      {
        type: 'warn',
        args: ['careful'],
        timestamp: EPOCH_ANCHOR + 820,
        source: 'browser'
      }
    ])
    expect(trace.metadata.viewport?.width).toBe(800)
    expect(
      (trace.metadata.capabilities as { browserName: string }).browserName
    ).toBe('chromium')
  })

  it('restores callSource and sources from the sidecar stacks entry', () => {
    const { trace } = parseTraceZip(foreignFixtureZip())
    expect(trace.commands[0].callSource).toBe(`${FOREIGN_SPEC}:10`)
    expect(trace.commands[1].callSource).toBe(`${FOREIGN_SPEC}:33`)
    expect(trace.sources).toEqual({ [FOREIGN_SPEC]: 'test("foreign")' })
  })

  it('nests runner steps by parentId and stepId-linked calls under them', () => {
    const { trace, groups } = parseTraceZip(foreignFixtureZip())
    // Root chronological: hook (600) < orphan fill (800) < runner expect (950).
    expect(groups).toHaveLength(3)
    const [hookChild, fillChild, expectChild] = groups ?? []
    expect('group' in hookChild! && hookChild.group.title).toBe('Before Hooks')
    expect(fillChild).toEqual({ commandIndex: 1 })
    expect(trace.commands[1].command).toBe('fill')
    expect(expectChild).toEqual({ commandIndex: 2 })
    const [hook, fixture, step] = allGroups(groups ?? [])
    expect(fixture.title).toBe('Fixture "browser"')
    expect(step.title).toBe('Click "go"')
    expect(hook.startTime).toBe(EPOCH_ANCHOR + 600)
    expect(hook.endTime).toBe(EPOCH_ANCHOR + 800)
    expect(commandIndices(step.children)).toEqual([0])
    expect(trace.commands[0].command).toBe('click')
  })

  it('propagates a wrapper-held error to the leaf and rolls failure up', () => {
    const { trace, groups } = parseTraceZip(foreignFixtureZip())
    expect(trace.commands[0].error?.message).toBe('wrapped failure')
    const [hook, fixture, step] = allGroups(groups ?? [])
    expect(step.failed).toBe(true)
    expect(fixture.failed).toBe(true)
    expect(hook.failed).toBe(true)
  })
})

describe('glued callSource recovery from older zips', () => {
  it('recovers the line glued onto the file path', () => {
    expect(
      stackToCallSource([{ file: '/x/steps.ts:17', line: 21, column: 0 }])
    ).toBe('/x/steps.ts:17')
  })

  it('recovers from a doubly glued file:line:column path', () => {
    expect(
      stackToCallSource([{ file: '/x/steps.ts:17:21', line: 0, column: 0 }])
    ).toBe('/x/steps.ts:17')
  })

  it('keeps Windows drive specs intact', () => {
    expect(
      stackToCallSource([{ file: 'C:\\proj\\steps.ts', line: 5, column: 1 }])
    ).toBe('C:\\proj\\steps.ts:5')
    expect(
      stackToCallSource([{ file: 'C:\\proj\\steps.ts:17', line: 21 }])
    ).toBe('C:\\proj\\steps.ts:17')
  })

  it('leaves clean frames unchanged', () => {
    expect(
      stackToCallSource([{ file: '/x/steps.ts', line: 42, column: 0 }])
    ).toBe('/x/steps.ts:42')
  })

  it('looks up sources under the unglued path sha1', () => {
    const clean = '/specs/glued.ts'
    const sha1 = createHash('sha1').update(clean).digest('hex')
    const before: BeforeEvent = {
      type: 'before',
      callId: 'call@1',
      startTime: 0,
      class: 'Element',
      method: 'click',
      stack: [{ file: `${clean}:17`, line: 21, column: 0 }]
    }
    const sources = buildSources([before], {
      [`resources/src@${sha1}.txt`]: strToU8('glued source')
    })
    expect(sources).toEqual({ [clean]: 'glued source' })
  })
})
