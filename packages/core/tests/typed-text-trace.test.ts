// @vitest-environment happy-dom
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MASKED_VALUE } from '@wdio/devtools-shared'
import { writeTraceZip } from '@wdio/devtools-trace/trace-exporter'
import {
  parseTraceEntries,
  unzipTraceZip
} from '@wdio/devtools-trace/trace-reader'

import { configureInputMasking, maskCommandArgs } from '../src/input-masking.js'
import { loadInjectableScript } from '../src/script-loader.js'
import { SessionCapturerBase } from '../src/session-capturer.js'

const SECRET = 'SuperSecretPassword!'

const collectorBuilt = await loadInjectableScript()
  .then(() => true)
  .catch(() => false)

/** Offline: no socket, so every send lands in the capturer's own arrays, which the writer reads. */
class RecordingCapturer extends SessionCapturerBase {
  constructor() {
    super({})
  }
  override sendUpstream(): void {}
  drain(payload: Parameters<SessionCapturerBase['processTracePayload']>[0]) {
    this.processTracePayload(payload)
  }
  terminal(line: string) {
    this.onLine('info', [line], 'terminal')
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const realFetch = window.fetch
const realLog = console.log

function type(selector: string, text: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!
  for (let i = 1; i <= text.length; i++) {
    field.value = text.slice(0, i)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // Pages that mirror the value into the attribute (controlled inputs) report it to the observer too.
  field.setAttribute('value', text)
}

/** A login as the adapters record one: the page's own collector, the rows an adapter sends, a log line, a request. */
async function recordLogin(maskInputs: boolean): Promise<string> {
  configureInputMasking({ maskInputs })
  delete window.wdioTraceCollector
  document.body.innerHTML =
    '<form><input id="username"><input id="password" type="password">' +
    '<textarea id="notes"></textarea></form>'
  window.fetch = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' }
    })
  )
  await (new Function(
    `return ${await loadInjectableScript()}`
  )() as Promise<void>)

  const capturer = new RecordingCapturer()
  let now = 1_000
  const send = (command: string, args: unknown[], result?: unknown) =>
    capturer.commandsLog.push({ command, args, result, timestamp: now++ }) &&
    capturer.sendCommand(capturer.commandsLog[capturer.commandsLog.length - 1])

  send('setValue', maskCommandArgs('webdriverio', 'setValue', ['tomsmith']))
  type('#username', 'tomsmith')
  // The client logs the protocol call after the adapter's hook saw the command, which is when the text is known.
  const typedArgs = maskCommandArgs('webdriverio', 'setValue', [SECRET])
  capturer.terminal(`COMMAND elementSendKeys("el-2", "${SECRET}")`)
  send('setValue', typedArgs)
  type('#password', SECRET)
  type('#notes', SECRET)
  send('getValue', [], SECRET)
  send('assert.equal', [SECRET, SECRET])
  console.log('logging in with', SECRET)
  await window.fetch('https://app.test/login', {
    method: 'POST',
    body: JSON.stringify({ password: SECRET })
  })
  await flush()

  capturer.drain(window.wdioTraceCollector!.getTraceData())
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'typed-text-'))
  return writeTraceZip(capturer, { outputDir, sessionId: 'login' })
}

/** Every place the secret survives in the archive, read entry by entry as the reader unpacks it. */
async function occurrences(zipPath: string): Promise<Record<string, number>> {
  const entries = unzipTraceZip(new Uint8Array(await fs.readFile(zipPath)))
  const found: Record<string, number> = {}
  for (const [name, bytes] of Object.entries(entries)) {
    const count = new TextDecoder().decode(bytes).split(SECRET).length - 1
    if (count > 0) {
      found[name] = count
    }
  }
  const player = JSON.stringify(parseTraceEntries(entries))
  found['(read back)'] = player.split(SECRET).length - 1
  return found
}

afterEach(() => {
  window.fetch = realFetch
  console.log = realLog
  delete window.wdioTraceCollector
  configureInputMasking()
})

describe('a trace of a login', () => {
  it.skipIf(!collectorBuilt)(
    'holds the typed secret nowhere with masking on',
    async () => {
      const zipPath = await recordLogin(true)
      expect(await occurrences(zipPath)).toEqual({ '(read back)': 0 })
      const entries = unzipTraceZip(new Uint8Array(await fs.readFile(zipPath)))
      const all = Object.values(entries)
        .map((bytes) => new TextDecoder().decode(bytes))
        .join('\n')
      expect(all).toContain(MASKED_VALUE)
    }
  )

  it.skipIf(!collectorBuilt)(
    'holds it everywhere it was typed, read and logged with masking off',
    async () => {
      const found = await occurrences(await recordLogin(false))
      expect(found).toMatchInlineSnapshot(`
        {
          "(read back)": 17,
          "trace.mutations": 4,
          "trace.trace": 13,
          "transcript.md": 4,
        }
      `)
    }
  )
})
