import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import type { NetworkRequest } from '@wdio/devtools-shared'
import { networkRequestToHar } from '../src/trace-har.js'
import {
  buildNetworkBodyResources,
  writeTraceZip,
  type TraceCapturer
} from '../src/trace-exporter.js'

const sha1 = (data: string): string =>
  createHash('sha1').update(data).digest('hex')

function req(
  id: string,
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    id,
    url: `https://api.example.com/items/${id}`,
    method: 'GET',
    status: 200,
    statusText: 'OK',
    timestamp: 1_000,
    startTime: 1_000,
    endTime: 1_050,
    time: 50,
    type: 'fetch',
    size: 7,
    response: {
      fromCache: false,
      headers: {},
      mimeType: 'application/json',
      status: 200
    },
    ...overrides
  }
}

describe('buildNetworkBodyResources', () => {
  it('writes a bare content-addressed resource per body', () => {
    const body = '{"a":1}'
    const { resources, sha1ByRequestId } = buildNetworkBodyResources([
      req('r1', { responseBody: body })
    ])
    expect(resources).toHaveLength(1)
    expect(resources[0]!.resourceName).toBe(sha1(body))
    expect(resources[0]!.data.toString('utf8')).toBe(body)
    expect(sha1ByRequestId.get('r1')).toBe(sha1(body))
  })

  it('skips requests without a responseBody', () => {
    const { resources, sha1ByRequestId } = buildNetworkBodyResources([
      req('r1'),
      req('r2', { responseBody: '{"b":2}' })
    ])
    expect(resources).toHaveLength(1)
    expect(sha1ByRequestId.has('r1')).toBe(false)
    expect(sha1ByRequestId.get('r2')).toBe(sha1('{"b":2}'))
  })

  it('dedupes identical bodies into a single resource', () => {
    const body = '{"shared":true}'
    const { resources, sha1ByRequestId } = buildNetworkBodyResources([
      req('r1', { responseBody: body }),
      req('r2', { responseBody: body })
    ])
    expect(resources).toHaveLength(1)
    expect(sha1ByRequestId.get('r1')).toBe(sha1(body))
    expect(sha1ByRequestId.get('r2')).toBe(sha1(body))
  })

  it('skips bodies above the per-body cap', () => {
    const { resources, sha1ByRequestId } = buildNetworkBodyResources(
      [req('r1', { responseBody: 'x'.repeat(11) })],
      { maxBodyBytes: 10, maxTotalBytes: 100 }
    )
    expect(resources).toHaveLength(0)
    expect(sha1ByRequestId.size).toBe(0)
  })

  it('stops storing new bodies past the total cap but keeps dedupe refs', () => {
    const first = 'aaaaaaaa'
    const second = 'bbbbbbbb'
    const { resources, sha1ByRequestId } = buildNetworkBodyResources(
      [
        req('r1', { responseBody: first }),
        req('r2', { responseBody: second }),
        req('r3', { responseBody: first })
      ],
      { maxBodyBytes: 10, maxTotalBytes: 12 }
    )
    expect(resources.map((r) => r.resourceName)).toEqual([sha1(first)])
    expect(sha1ByRequestId.get('r1')).toBe(sha1(first))
    expect(sha1ByRequestId.has('r2')).toBe(false)
    expect(sha1ByRequestId.get('r3')).toBe(sha1(first))
  })

  it('measures caps in utf8 bytes, not string length', () => {
    // Three-byte characters: 4 chars = 12 bytes, over a 10-byte cap.
    const multibyte = '€€€€'
    const { resources } = buildNetworkBodyResources(
      [req('r1', { responseBody: multibyte })],
      { maxBodyBytes: 10, maxTotalBytes: 100 }
    )
    expect(resources).toHaveLength(0)
  })
})

describe('networkRequestToHar response bodies', () => {
  it('emits plain content when no body was captured', () => {
    const { snapshot } = networkRequestToHar(req('r1'))
    expect(snapshot.response.content).toEqual({
      size: 7,
      mimeType: 'application/json'
    })
  })

  it('inlines small bodies as text and stamps _sha1 when provided', () => {
    const body = '{"a":1}'
    const { snapshot } = networkRequestToHar(
      req('r1', { responseBody: body }),
      {
        bodySha1: sha1(body)
      }
    )
    expect(snapshot.response.content.text).toBe(body)
    expect(snapshot.response.content._sha1).toBe(sha1(body))
  })

  it('omits inline text at and above the 8 KiB threshold', () => {
    const body = 'x'.repeat(8 * 1024)
    const { snapshot } = networkRequestToHar(
      req('r1', { responseBody: body }),
      {
        bodySha1: sha1(body)
      }
    )
    expect(snapshot.response.content.text).toBeUndefined()
    expect(snapshot.response.content._sha1).toBe(sha1(body))
  })

  it('inlines text even without a bodySha1 ref', () => {
    const body = 'plain'
    const { snapshot } = networkRequestToHar(req('r1', { responseBody: body }))
    expect(snapshot.response.content.text).toBe(body)
    expect(snapshot.response.content._sha1).toBeUndefined()
  })
})

describe('writeTraceZip body wiring (ndjson-directory)', () => {
  it('writes body resources and _sha1 refs into the trace output', async () => {
    const body = '{"answer":42}'
    const capturer: TraceCapturer = {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [
        req('n1', { responseBody: body }),
        req('n2', { responseBody: body })
      ],
      commandsLog: [],
      sources: new Map(),
      startWallTime: 900
    }
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-bodies-'))
    const dir = await writeTraceZip(capturer, {
      outputDir,
      sessionId: 'abc12345',
      format: 'ndjson-directory'
    })
    const network = await fs.readFile(path.join(dir, 'trace.network'), 'utf8')
    const entries = network
      .split('\n')
      .filter((line) => line.trim())
      .map(
        (line) =>
          JSON.parse(line) as {
            snapshot: { response: { content: Record<string, unknown> } }
          }
      )
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.snapshot.response.content._sha1).toBe(sha1(body))
      expect(entry.snapshot.response.content.text).toBe(body)
    }
    const resource = await fs.readFile(
      path.join(dir, 'resources', sha1(body)),
      'utf8'
    )
    expect(resource).toBe(body)
    await fs.rm(outputDir, { recursive: true, force: true })
  })
})
