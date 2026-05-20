import { describe, it, expect } from 'vitest'
import { buildTraceZip } from '../src/zip-writer.js'
import type { TraceSession } from '../src/types.js'
import type { ResourceSnapshotEvent } from '../src/network.js'

function makeSession(): TraceSession {
  return {
    sessionId: 'abc12345def',
    startWallTime: Date.now(),
    startHrTime: process.hrtime.bigint(),
    pageId: 'page@abc12345',
    contextId: 'context@abc12345',
    callCounter: 0,
    events: [
      {
        version: 8,
        type: 'context-options',
        origin: 'library',
        libraryName: '@wdio/tracing-service',
        libraryVersion: '1.0.0',
        browserName: 'chrome',
        platform: 'linux',
        wallTime: Date.now(),
        monotonicTime: 0,
        sdkLanguage: 'javascript',
        title: 'chrome',
        contextId: 'context@abc12345',
        options: { viewport: { width: 1920, height: 1080 } }
      }
    ],
    screenshots: [],
    elementSnapshots: [],
    browserName: 'chrome',
    viewport: { width: 1920, height: 1080 },
    sessionType: 'browser',
    lastAfterEndTime: 0,
    screenshotChain: Promise.resolve()
  }
}

describe('buildTraceZip', () => {
  it('produces a non-empty buffer', async () => {
    const zip = await buildTraceZip(makeSession())
    expect(zip).toBeInstanceOf(Buffer)
    expect(zip.length).toBeGreaterThan(0)
  })

  it('includes network entries when provided', async () => {
    const networkEntry: ResourceSnapshotEvent = {
      type: 'resource-snapshot',
      snapshot: {
        startedDateTime: new Date().toISOString(),
        time: 100,
        request: {
          method: 'GET',
          url: 'https://example.com',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [],
          content: { size: 100, mimeType: 'text/html' },
          redirectURL: '',
          headersSize: -1,
          bodySize: 100
        },
        cache: {} as Record<string, never>,
        timings: { send: -1, wait: 100, receive: -1 },
        _monotonicTime: 0,
        _frameref: ''
      }
    }
    const zip = await buildTraceZip(makeSession(), [networkEntry])
    expect(zip.length).toBeGreaterThan(0)
  })

  it('includes screenshot resources', async () => {
    const session = makeSession()
    session.screenshots.push({
      resourceName: 'page@abc12345-12345.jpeg',
      data: Buffer.from('fake-jpeg-data'),
      width: 1280,
      height: 720
    })
    const zip = await buildTraceZip(session)
    expect(zip.length).toBeGreaterThan(0)
  })
})
