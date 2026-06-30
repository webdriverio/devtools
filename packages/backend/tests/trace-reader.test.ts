import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseTraceZip } from '../src/trace-reader.js'

const WALL_TIME = 1_000_000
const IMG1 = Buffer.from('frame-one').toString('base64')
const IMG2 = Buffer.from('frame-two').toString('base64')
const IMG3 = Buffer.from('frame-three').toString('base64')

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
    { type: 'after', callId: 'call@1', endTime: 50 },
    {
      type: 'before',
      callId: 'call@2',
      startTime: 100,
      class: 'Element',
      method: 'fill',
      params: { selector: '#name', value: 'vishnu' }
    },
    { type: 'after', callId: 'call@2', endTime: 160 },
    {
      type: 'before',
      callId: 'call@3',
      startTime: 200,
      class: 'Element',
      method: 'click',
      params: { selector: '#submit' }
    },
    {
      type: 'after',
      callId: 'call@3',
      endTime: 260,
      error: { message: 'boom' }
    },
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
    }
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
    'trace.trace': strToU8(
      events.map((e) => JSON.stringify(e)).join('\n') + '\n'
    ),
    'trace.network': strToU8(JSON.stringify(networkEntry)),
    'resources/page@abcd1234-0.jpeg': new Uint8Array(Buffer.from('frame-one')),
    'resources/page@abcd1234-160.jpeg': new Uint8Array(
      Buffer.from('frame-two')
    ),
    'resources/page@abcd1234-260.jpeg': new Uint8Array(
      Buffer.from('frame-three')
    )
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
    expect(trace.consoleLogs).toEqual([])
    expect(trace.mutations).toEqual([])
    expect(trace.suites).toEqual([])
    expect(trace.sources).toEqual({})
  })
})
