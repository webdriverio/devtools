import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSecretRedactor, MASKED_VALUE } from '@wdio/devtools-shared'
import { unzipSync, zipSync } from 'fflate'

import { redactTraceArtifact } from '../src/trace-artifact-redaction.js'

const SECRET = 'SuperSecretPassword!'
const redactor = createSecretRedactor([SECRET])!
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
// A PNG signature: not UTF-8, so the entry is never read as text.
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SCREENSHOT = `${'A'.repeat(300)}${SECRET}`

describe('redactTraceArtifact', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-artifact-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('redacts every text entry of a zip and keeps binary entries and base64 fields as they are', async () => {
    const zipPath = path.join(dir, 'trace.zip')
    const trace = [
      JSON.stringify({ type: 'source', text: `setValue('${SECRET}')` }),
      JSON.stringify({ type: 'frame', screenshot: SCREENSHOT })
    ].join('\n')
    await fs.writeFile(
      zipPath,
      zipSync({
        'trace.trace': encode(trace),
        'transcript.md': encode(`typed ${SECRET}\nnext line`),
        'resources/shot.png': IMAGE
      })
    )

    expect(await redactTraceArtifact(zipPath, redactor)).toBe(true)
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const [source, frame] = decode(entries['trace.trace']).split('\n')
    expect(JSON.parse(source).text).toBe(`setValue('${MASKED_VALUE}')`)
    expect(JSON.parse(frame).screenshot).toBe(SCREENSHOT)
    expect(decode(entries['transcript.md'])).toBe(
      `typed ${MASKED_VALUE}\nnext line`
    )
    expect(entries['resources/shot.png']).toEqual(IMAGE)
  })

  it('keeps a reference to an archive entry whose name holds a secret, so the entry still resolves', async () => {
    const hex = '1234abcd'
    const hexRedactor = createSecretRedactor([hex])!
    const zipPath = path.join(dir, 'trace.zip')
    const shot = `page@1-${hex}.png`
    const body = `ff${hex}00`
    const trace = [
      JSON.stringify({ type: 'screencast-frame', sha1: shot, title: hex }),
      JSON.stringify({
        type: 'resource-snapshot',
        snapshot: { response: { content: { _sha1: body, text: hex } } }
      })
    ].join('\n')
    await fs.writeFile(
      zipPath,
      zipSync({
        'trace.trace': encode(trace),
        [`resources/${shot}`]: IMAGE,
        [`resources/${body}`]: encode(`body ${hex}`)
      })
    )

    expect(await redactTraceArtifact(zipPath, hexRedactor)).toBe(true)
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const [frame, resource] = decode(entries['trace.trace'])
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(frame).toEqual({
      type: 'screencast-frame',
      sha1: shot,
      title: MASKED_VALUE
    })
    expect(resource.snapshot.response.content).toEqual({
      _sha1: body,
      text: MASKED_VALUE
    })
    expect(entries[`resources/${shot}`]).toEqual(IMAGE)
    expect(decode(entries[`resources/${body}`])).toBe(`body ${MASKED_VALUE}`)
  })

  it('redacts captured text that happens to equal an entry name', async () => {
    const entryRedactor = createSecretRedactor(['trace.trace'])!
    const zipPath = path.join(dir, 'trace.zip')
    const consoleEvent = {
      type: 'console',
      text: 'trace.trace',
      args: [{ preview: 'trace.trace', value: 'trace.trace' }]
    }
    await fs.writeFile(
      zipPath,
      zipSync({ 'trace.trace': encode(JSON.stringify(consoleEvent)) })
    )
    expect(await redactTraceArtifact(zipPath, entryRedactor)).toBe(true)
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    expect(JSON.parse(decode(entries['trace.trace']))).toEqual({
      type: 'console',
      text: MASKED_VALUE,
      args: [{ preview: MASKED_VALUE, value: MASKED_VALUE }]
    })
  })

  it('keeps entry references in an ndjson directory too', async () => {
    const hex = '1234abcd'
    const hexRedactor = createSecretRedactor([hex])!
    const shot = `page@1-${hex}.png`
    await fs.mkdir(path.join(dir, 'resources'))
    await fs.writeFile(path.join(dir, 'resources', shot), IMAGE)
    await fs.writeFile(
      path.join(dir, 'trace.trace'),
      JSON.stringify({ sha1: shot, title: hex })
    )
    expect(await redactTraceArtifact(dir, hexRedactor)).toBe(true)
    expect(
      JSON.parse(await fs.readFile(path.join(dir, 'trace.trace'), 'utf8'))
    ).toEqual({ sha1: shot, title: MASKED_VALUE })
  })

  it('redacts a numeric password from a raw body entry', async () => {
    const numeric = createSecretRedactor(['123456'])!
    const zipPath = path.join(dir, 'trace.zip')
    await fs.writeFile(
      zipPath,
      zipSync({ 'resources/body-sha': encode('123456') })
    )
    expect(await redactTraceArtifact(zipPath, numeric)).toBe(true)
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    expect(decode(entries['resources/body-sha'])).toBe(MASKED_VALUE)
  })

  it('redacts a password from a JSON string body that spells it with escapes', async () => {
    const zipPath = path.join(dir, 'trace.zip')
    const escaped = `"\\u0053${SECRET.slice(1)}"`
    await fs.writeFile(
      zipPath,
      zipSync({ 'resources/body-sha': encode(escaped) })
    )
    expect(await redactTraceArtifact(zipPath, redactor)).toBe(true)
    const entries = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    expect(JSON.parse(decode(entries['resources/body-sha']))).toBe(MASKED_VALUE)
  })

  it('leaves an archive with nothing to redact untouched', async () => {
    const zipPath = path.join(dir, 'trace.zip')
    const bytes = zipSync({ 'trace.trace': encode('{"type":"x"}') })
    await fs.writeFile(zipPath, bytes)
    expect(await redactTraceArtifact(zipPath, redactor)).toBe(false)
    expect(new Uint8Array(await fs.readFile(zipPath))).toEqual(bytes)
  })

  it('redacts the files of an ndjson directory, nested ones included', async () => {
    await fs.mkdir(path.join(dir, 'resources'))
    await fs.writeFile(path.join(dir, 'resources', 'src.txt'), `pw ${SECRET}`)
    expect(await redactTraceArtifact(dir, redactor)).toBe(true)
    expect(
      await fs.readFile(path.join(dir, 'resources', 'src.txt'), 'utf8')
    ).toBe(`pw ${MASKED_VALUE}`)
  })

  it('does nothing for an artifact that is gone', async () => {
    expect(
      await redactTraceArtifact(path.join(dir, 'missing.zip'), redactor)
    ).toBe(false)
  })
})
