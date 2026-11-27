// The console lines and requests the console and network queries are tested on, written with this checkout's writer.

import {
  NETWORK_CAPTURE_SOURCE,
  type CommandLog,
  type ConsoleLog,
  type NetworkRequest
} from '@wdio/devtools-shared'
import type { TraceHandle } from '../src/types.js'
import { openWritten } from './traces.js'

/** Wall-clock start of both synthetic traces; every time below is an offset from it. */
export const START = 1_700_000_000_000
export const ORIGIN = 'http://127.0.0.1:4567'

const COMMANDS: CommandLog[] = [
  {
    command: 'url',
    args: [`${ORIGIN}/login`],
    startTime: START + 100,
    timestamp: START + 400
  },
  {
    command: 'click',
    args: [],
    startTime: START + 5000,
    timestamp: START + 5200
  },
  {
    command: 'getTitle',
    args: [],
    result: 'Secure Area',
    startTime: START + 9000,
    timestamp: START + 9100
  }
]

/** A long stored body: past the writer's inline limit, so only `resources/<sha1>` holds it. */
export const STORED_BODY = JSON.stringify({ items: 'x'.repeat(10_000) })
export const LONG_LINE = 'Error: boom '.repeat(500)

const CONSOLE: ConsoleLog[] = [
  {
    type: 'log',
    args: ['page loaded', { ready: true }],
    timestamp: START + 300,
    source: 'browser'
  },
  {
    type: 'warn',
    args: ['deprecated API'],
    timestamp: START + 5100,
    source: 'browser'
  },
  {
    type: 'error',
    args: ['TypeError: user is undefined'],
    timestamp: START + 5150,
    source: 'browser'
  },
  {
    type: 'log',
    args: ['\u001b[32m✓\u001b[39m login step'],
    timestamp: START + 5300,
    source: 'terminal'
  },
  {
    type: 'debug',
    args: ['edge inside'],
    timestamp: START + 2400,
    source: 'browser'
  },
  {
    type: 'debug',
    args: ['edge outside'],
    timestamp: START + 2401,
    source: 'browser'
  },
  { type: 'error', args: [LONG_LINE], timestamp: START + 9050, source: 'test' }
]

function request(
  fields: Partial<NetworkRequest> & Pick<NetworkRequest, 'id' | 'url'>
): NetworkRequest {
  return {
    method: 'GET',
    type: 'fetch',
    timestamp: fields.startTime ?? START,
    startTime: START,
    ...fields
  }
}

const CHROME_NETWORK: NetworkRequest[] = [
  request({
    id: 'doc',
    url: `${ORIGIN}/login`,
    type: 'document',
    startTime: START + 150,
    timestamp: START + 150,
    endTime: START + 180,
    time: 30,
    status: 200,
    statusText: 'OK',
    requestHeaders: {
      accept: 'text/html',
      cookie: `session=${'c'.repeat(3000)}`
    },
    responseHeaders: { 'content-type': 'text/html' },
    response: {
      fromCache: false,
      headers: { 'content-type': 'text/html' },
      mimeType: 'text/html',
      status: 200
    }
  }),
  request({
    id: 'api',
    url: `${ORIGIN}/api/user?id=7`,
    method: 'POST',
    startTime: START + 5050,
    timestamp: START + 5050,
    endTime: START + 5090,
    time: 40,
    status: 500,
    statusText: 'Internal Server Error',
    requestHeaders: { authorization: 'Bearer token' },
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"error":"user not found"}',
    response: {
      fromCache: false,
      headers: { 'content-type': 'application/json' },
      mimeType: 'application/json',
      status: 500
    }
  }),
  request({
    id: 'big',
    url: `${ORIGIN}/api/items`,
    startTime: START + 5060,
    timestamp: START + 5060,
    endTime: START + 5070,
    time: 10,
    status: 200,
    statusText: 'OK',
    responseBody: STORED_BODY,
    response: {
      fromCache: false,
      headers: {},
      mimeType: 'application/json',
      status: 200
    }
  }),
  request({
    id: 'beacon',
    url: `https://analytics.example.com/collect?${'q'.repeat(400)}`,
    startTime: START + 9020,
    timestamp: START + 9020,
    endTime: START + 9021,
    time: 1,
    status: 0,
    statusText: 'net::ERR_CONNECTION_REFUSED'
  }),
  request({
    id: 'slow',
    url: `${ORIGIN}/api/slow`,
    startTime: START + 8800,
    timestamp: START + 8800,
    endTime: START + 9010,
    time: 210,
    status: 200,
    statusText: 'OK'
  })
]

/** Safari and Appium serve no BiDi, so every row comes from the page's Resource Timing buffer. */
const RESOURCE_TIMING_NETWORK: NetworkRequest[] = [
  request({
    id: 'rt-doc',
    url: `${ORIGIN}/login`,
    method: '',
    type: 'document',
    startTime: START + 150,
    timestamp: START + 150,
    endTime: START + 200,
    time: 50,
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  }),
  request({
    id: 'rt-img',
    url: `${ORIGIN}/img/logo.png`,
    type: 'image',
    startTime: START + 250,
    timestamp: START + 250,
    endTime: START + 260,
    time: 10,
    size: 512,
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  }),
  request({
    id: 'rt-api',
    url: `${ORIGIN}/api/user?id=7`,
    method: '',
    startTime: START + 5050,
    timestamp: START + 5050,
    endTime: START + 5090,
    time: 40,
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  })
]

/** A Chrome run with a failed API call, a transport failure, a stored body and a long header. */
export function openChromeTrace(): Promise<TraceHandle> {
  return openWritten({
    commands: COMMANDS,
    consoleLogs: CONSOLE,
    networkRequests: CHROME_NETWORK,
    startTime: START
  })
}

/** A Safari run whose network comes only from Resource Timing. */
export function openResourceTimingTrace(): Promise<TraceHandle> {
  return openWritten({
    commands: COMMANDS,
    consoleLogs: CONSOLE,
    networkRequests: RESOURCE_TIMING_NETWORK,
    startTime: START,
    browserName: 'safari'
  })
}

/** Many console lines and requests of every length, some with characters JSON escapes, so a listing spans pages. */
export function openBusyTrace(): Promise<TraceHandle> {
  const lengths = [10, 80, 400, 1_500, 6_000]
  return openWritten({
    commands: COMMANDS,
    consoleLogs: Array.from({ length: 40 }, (_, i) => ({
      type: i % 3 === 0 ? 'error' : 'log',
      args: [`line ${i} "quoted"\n${'z'.repeat(lengths[i % lengths.length]!)}`],
      timestamp: START + 100 + i * 10,
      source: 'browser'
    })),
    networkRequests: Array.from({ length: 40 }, (_, i) =>
      request({
        id: `busy-${i}`,
        url: `${ORIGIN}/api/${i}?q="${'u'.repeat(lengths[i % lengths.length]!)}"`,
        startTime: START + 100 + i * 10,
        timestamp: START + 100 + i * 10,
        endTime: START + 105 + i * 10,
        time: 5,
        status: i % 4 === 0 ? 500 : 200,
        statusText: i % 4 === 0 ? `Server "Error"\n${'s'.repeat(500)}` : 'OK'
      })
    ),
    startTime: START
  })
}

export const HEAVY_BODY = `{"rows":"${'b'.repeat(30_000)}"}`

/** One request with more headers, and a longer body, than a small budget holds. */
export function openHeavyRequestTrace(): Promise<TraceHandle> {
  const headers = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [`x-header-${i}`, 'h'.repeat(300)])
  )
  return openWritten({
    commands: COMMANDS,
    networkRequests: [
      request({
        id: 'heavy',
        url: `${ORIGIN}/api/heavy?${'p'.repeat(3_000)}`,
        startTime: START + 150,
        endTime: START + 180,
        time: 30,
        status: 200,
        statusText: 'OK',
        requestHeaders: headers,
        responseHeaders: headers,
        responseBody: HEAVY_BODY,
        response: {
          fromCache: false,
          headers,
          mimeType: 'application/json',
          status: 200
        }
      })
    ],
    startTime: START
  })
}

/** One request carrying the headers and body a test names. */
export function openOneRequestTrace(
  headers: Record<string, string>,
  body: string,
  mimeType = 'text/plain'
): Promise<TraceHandle> {
  return openWritten({
    commands: COMMANDS,
    networkRequests: [
      request({
        id: 'one',
        url: `${ORIGIN}/api/one`,
        startTime: START + 150,
        endTime: START + 180,
        time: 30,
        status: 200,
        statusText: 'OK',
        requestHeaders: headers,
        responseBody: body,
        response: { fromCache: false, headers: {}, mimeType, status: 200 }
      })
    ],
    startTime: START
  })
}
