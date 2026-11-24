import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { strFromU8, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSecretRedactor,
  REDACTED_SECRET,
  type NetworkRequest,
  type SecretRedactor,
  type TestMetadataMap
} from '@wdio/devtools-shared'

import { writeTraceZip, type TraceCapturer } from '../src/trace-exporter.js'

const SECRET = 'Super Secret!'
const FORMS = [SECRET, 'Super%20Secret!', 'Super+Secret%21']
const SPEC = '/project/test/login.spec.ts'

function request(): NetworkRequest {
  return {
    id: 'r1',
    url: 'https://example.test/login?password=Super%20Secret!',
    method: 'POST',
    status: 200,
    statusText: 'OK',
    timestamp: 1_100,
    startTime: 1_100,
    endTime: 1_150,
    time: 50,
    type: 'fetch',
    size: 30,
    headers: { authorization: `Basic ${SECRET}` },
    requestHeaders: {
      Authorization: 'Bearer live-t0ken',
      Cookie: 'sid=s3ssion'
    },
    responseHeaders: { 'Set-Cookie': 'sid=s3ssion; HttpOnly' },
    requestBody: 'user=tom&password=Super+Secret%21',
    responseBody: JSON.stringify({ echo: SECRET }),
    response: {
      fromCache: false,
      headers: {
        'x-echo': SECRET,
        'Set-Cookie': 'sid=s3ssion; HttpOnly',
        'Content-Type': 'application/json'
      },
      mimeType: 'application/json',
      status: 200
    }
  }
}

// The secret in every place a run can put it: a typed row, its error, console, stdout, network, the DOM stream, the test source and an action's capture.
function capturer(): TraceCapturer {
  return {
    commandsLog: [
      {
        command: 'setValue',
        args: ['#password', SECRET],
        result: `typed ${SECRET}`,
        error: new Error(`could not type ${SECRET}`),
        timestamp: 1_050,
        callSource: `${SPEC}:3:5`
      }
    ],
    consoleLogs: [
      { type: 'log', args: [`logging in with ${SECRET}`], timestamp: 1_060 }
    ],
    traceLogs: [`stdout: ${SECRET}`],
    networkRequests: [request()],
    mutations: [
      ...['Supe', 'Super Se', SECRET].map((value, i) => ({
        type: 'attributes' as const,
        attributeName: 'value',
        attributeValue: value,
        target: 'ref-1',
        addedNodes: [],
        removedNodes: [],
        timestamp: 1_070 + i
      })),
      {
        type: 'childList',
        addedNodes: [{ nodeName: '#text', textContent: `Use ${SECRET}` }],
        removedNodes: [],
        timestamp: 1_080
      }
    ],
    sources: new Map([[SPEC, `await $('#password').setValue('${SECRET}')`]]),
    startWallTime: 1_000
  }
}

const testMetadata: TestMetadataMap = new Map([
  ['t1', { title: `logs in as ${SECRET}`, specFile: SPEC }]
])

let outputDir = ''
afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true })
})

async function writeEntries(
  redactor: SecretRedactor | undefined
): Promise<Record<string, string>> {
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-secrets-'))
  const zipPath = await writeTraceZip(capturer(), {
    outputDir,
    sessionId: 'abc12345',
    testMetadata,
    actionSnapshots: [
      {
        timestamp: 1_050,
        command: 'setValue',
        url: 'https://example.test/login?password=Super%20Secret!',
        title: SECRET,
        elements: [{ selector: '#password', value: SECRET }],
        snapshotText: `- textbox "${SECRET}"`
      }
    ],
    redactor
  })
  const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)])
  )
}

const carriers = (entries: Record<string, string>) =>
  Object.keys(entries)
    .filter((name) => FORMS.some((form) => entries[name].includes(form)))
    .sort()

describe('writeTraceZip with the run’s secrets', () => {
  it('reaches every entry the fixture puts the secret in when nothing is redacted', async () => {
    const entries = await writeEntries(undefined)
    expect(carriers(entries)).toEqual(
      expect.arrayContaining([
        'trace.trace',
        'trace.network',
        'trace.mutations',
        'transcript.md'
      ])
    )
    expect(
      carriers(entries).filter((name) => name.startsWith('resources/'))
    ).not.toEqual([])
  })

  it('leaves no form of the secret in any entry', async () => {
    const entries = await writeEntries(createSecretRedactor([SECRET]))
    expect(carriers(entries)).toEqual([])
    expect(entries['transcript.md']).toContain(REDACTED_SECRET)
  })

  it('replaces a typed password everywhere a listed secret is, and keeps its keystroke prefixes', async () => {
    const entries = await writeEntries(
      createSecretRedactor([], { typed: [SECRET] })
    )
    expect(carriers(entries)).toEqual([])
    expect(entries['trace.mutations']).toContain('"Super Se"')
  })

  it('writes credential header values as the placeholder in the HAR, keeping their names', async () => {
    const plain = await writeEntries(undefined)
    expect(plain['trace.network']).toContain('live-t0ken')
    const entries = await writeEntries(
      createSecretRedactor([], { authHeaders: true })
    )
    const network = entries['trace.network']
    for (const value of ['live-t0ken', 's3ssion']) {
      expect(network).not.toContain(value)
    }
    for (const name of ['Authorization', 'Cookie', 'Set-Cookie']) {
      expect(network).toContain(`"name":"${name}","value":"${REDACTED_SECRET}"`)
    }
    expect(network).toContain(
      '"name":"Content-Type","value":"application/json"'
    )
  })
})
