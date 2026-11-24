import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MASKED_VALUE, type TestMetadataMap } from '@wdio/devtools-shared'

import { SessionCapturerBase } from '../src/session-capturer.js'
import {
  configureSecretRedaction,
  FIELD_TYPE_PROBE_TIMEOUT_MS,
  noteTypedInput,
  redactSecrets,
  secretRedactor
} from '../src/secret-redaction.js'
import {
  finalizeTraceExport,
  type TraceExportContext
} from '../src/trace-finalizer.js'
import type { TraceCapturer } from '@wdio/devtools-trace/trace-exporter'

const SECRET = 'SuperSecretPassword!'

const { sockets, FakeSocket } = vi.hoisted(() => {
  const sockets: { sent: string[] }[] = []
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    readyState = 1
    sent: string[] = []
    constructor() {
      sockets.push(this)
    }
    on() {}
    send(payload: string) {
      this.sent.push(payload)
    }
  }
  return { sockets, FakeSocket }
})

vi.mock('ws', () => ({ WebSocket: FakeSocket }))

/** Forgets learned passwords too, which only turning input masking off does. */
function resetRedaction(): void {
  configureSecretRedaction({ maskInputs: false })
  configureSecretRedaction()
}

afterEach(resetRedaction)

describe('configureSecretRedaction', () => {
  it('redacts only credential headers until the run lists or types a secret', () => {
    expect(configureSecretRedaction()).toEqual([])
    expect(secretRedactor()?.secrets).toEqual([])
    expect(
      redactSecrets({
        headers: { Cookie: 'sid=1', Accept: '*/*' },
        text: SECRET
      })
    ).toEqual({
      headers: { Cookie: MASKED_VALUE, Accept: '*/*' },
      text: SECRET
    })
  })

  it('redacts nothing at all with input masking off and no secrets', () => {
    configureSecretRedaction({ maskInputs: false })
    expect(secretRedactor()).toBeUndefined()
  })

  it('reads an env entry at start and returns the warnings to log', () => {
    const warnings = configureSecretRedaction(
      { secrets: [{ env: 'LOGIN_PASSWORD' }, { env: 'UNSET_ONE' }, 'abc'] },
      { LOGIN_PASSWORD: SECRET }
    )
    expect(secretRedactor()?.secrets).toEqual([SECRET])
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).not.toContain('abc')
  })
})

describe('noteTypedInput', () => {
  const passwordField = vi.fn(async () => 'password')

  it('adds what was typed into a password field, read once per value', async () => {
    configureSecretRedaction()
    passwordField.mockClear()
    await noteTypedInput([SECRET, '\uE007'], passwordField)
    await noteTypedInput(SECRET, passwordField)
    expect(passwordField).toHaveBeenCalledTimes(1)
    expect(redactSecrets(`typed ${SECRET}`)).toBe(`typed ${MASKED_VALUE}`)
  })

  it('keeps text typed into any other field', async () => {
    configureSecretRedaction()
    await noteTypedInput('tomsmith', async () => 'text')
    expect(redactSecrets('tomsmith')).toBe('tomsmith')
  })

  it('reads no field type for a value too short to redact or with input masking off', async () => {
    const read = vi.fn(async () => 'password')
    configureSecretRedaction()
    await noteTypedInput('abc', read)
    configureSecretRedaction({ maskInputs: false })
    await noteTypedInput(SECRET, read)
    expect(read).not.toHaveBeenCalled()
    expect(redactSecrets(SECRET)).toBe(SECRET)
  })

  it('lets the command go on when the read fails or hangs', async () => {
    vi.useFakeTimers()
    try {
      configureSecretRedaction()
      await noteTypedInput(SECRET, () => Promise.reject(new Error('stale')))
      await noteTypedInput(SECRET, () => {
        throw new Error('no driver address')
      })
      const hung = noteTypedInput('other-secret', () => new Promise(() => {}))
      await vi.advanceTimersByTimeAsync(FIELD_TYPE_PROBE_TIMEOUT_MS)
      await hung
      expect(redactSecrets(`${SECRET} other-secret`)).toBe(
        `${SECRET} other-secret`
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps learned values when the run is configured again, unless input masking is turned off', async () => {
    resetRedaction()
    await noteTypedInput(SECRET, passwordField)
    configureSecretRedaction({ secrets: ['another-secret'] })
    expect(redactSecrets(SECRET)).toBe(MASKED_VALUE)
    configureSecretRedaction({ maskInputs: false })
    expect(redactSecrets(SECRET)).toBe(SECRET)
  })
})

describe('sendUpstream', () => {
  it('sends a row typed into a password field redacted, with no secrets listed', async () => {
    configureSecretRedaction()
    await noteTypedInput(SECRET, async () => 'password')
    const capturer = new SessionCapturerBase({ hostname: 'localhost', port: 1 })
    capturer.sendUpstream('commands', [{ command: 'setValue', args: [SECRET] }])
    expect(sockets.at(-1)!.sent.at(-1)).not.toContain(SECRET)
  })

  it('sends a frame with the run’s secrets redacted, keeping the scope and the caller’s value', () => {
    configureSecretRedaction({ secrets: [SECRET] })
    const capturer = new SessionCapturerBase({
      hostname: 'localhost',
      port: 1
    })
    const row = { command: 'setValue', args: ['#password', SECRET] }
    capturer.sendUpstream('commands', [row])
    const sent = JSON.parse(sockets.at(-1)!.sent.at(-1)!)
    expect(sent).toEqual({
      scope: 'commands',
      data: [{ command: 'setValue', args: ['#password', MASKED_VALUE] }]
    })
    expect(row.args[1]).toBe(SECRET)
  })

  it('sends the payload as it is when no secret is listed or typed', () => {
    resetRedaction()
    const capturer = new SessionCapturerBase({
      hostname: 'localhost',
      port: 1
    })
    capturer.sendUpstream('commands', [{ args: [SECRET] }])
    expect(sockets.at(-1)!.sent.at(-1)).toContain(SECRET)
  })
})

describe('finalizeTraceExport', () => {
  let outputDir = ''
  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-secrets-'))
  })
  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  const capturer = (): TraceCapturer => ({
    mutations: [],
    traceLogs: [`typed ${SECRET}`],
    consoleLogs: [{ type: 'log', args: [SECRET], timestamp: 1_050 }],
    networkRequests: [],
    commandsLog: [
      {
        command: 'url',
        args: ['https://example.test/login'],
        timestamp: 1_000
      },
      { command: 'setValue', args: ['#password', SECRET], timestamp: 1_100 }
    ],
    sources: new Map([['/spec.js', `setValue('${SECRET}')`]]),
    startWallTime: 1_000
  })

  const testMetadata: TestMetadataMap = new Map([
    ['u1', { title: `logs in with ${SECRET}`, specFile: '/spec.js' }]
  ])

  function ctx(overrides: Partial<TraceExportContext>): TraceExportContext {
    return {
      mode: 'trace',
      granularity: 'session',
      format: 'ndjson-directory',
      capturer: capturer(),
      actionSnapshots: [],
      sessionId: 'abcd1234',
      testMetadata,
      ranges: [],
      flushed: new Set(),
      resolveOutputDir: () => outputDir,
      ...overrides
    }
  }

  async function filesCarrying(text: string): Promise<string[]> {
    const names = await fs.readdir(outputDir, { recursive: true })
    const carrying: string[] = []
    for (const name of names) {
      const file = path.join(outputDir, name)
      if ((await fs.stat(file)).isFile()) {
        if ((await fs.readFile(file, 'utf8')).includes(text)) {
          carrying.push(name)
        }
      }
    }
    return carrying
  }

  it('writes the secret into a session trace when none is listed or typed into a password field', async () => {
    resetRedaction()
    await finalizeTraceExport(ctx({}))
    expect(await filesCarrying(SECRET)).not.toEqual([])
  })

  it('writes no file carrying a password the run typed, with no secrets listed', async () => {
    configureSecretRedaction()
    await noteTypedInput(SECRET, async () => 'password')
    await finalizeTraceExport(ctx({}))
    expect(await filesCarrying(SECRET)).toEqual([])
  })

  it.each(['session', 'spec'] as const)(
    'writes no file carrying a listed secret (%s granularity)',
    async (granularity) => {
      configureSecretRedaction({ secrets: [SECRET] })
      await finalizeTraceExport(
        ctx({
          granularity,
          ranges: [
            {
              specFile: '/spec.js',
              key: '/spec.js',
              commandStartIdx: 0,
              consoleStartIdx: 0,
              networkStartIdx: 0,
              mutationStartIdx: 0,
              traceLogStartIdx: 0
            }
          ]
        })
      )
      expect(await filesCarrying(MASKED_VALUE)).not.toEqual([])
      expect(await filesCarrying(SECRET)).toEqual([])
    }
  )
})
