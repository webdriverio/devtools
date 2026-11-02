import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearTypedValues,
  configureInputMasking,
  writeTraceZip
} from '@wdio/devtools-core'

import { SessionCapturer } from '../src/session.js'

const SECRET = 'S3cret pass'

/** Every entry's text, read off the zip's central directory, so the check covers what the writer wrote and nothing else. */
async function zipText(zipPath: string): Promise<string> {
  const zip = await fs.readFile(zipPath)
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let at = zip.readUInt32LE(end + 16)
  const texts: string[] = []
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const local = zip.readUInt32LE(at + 42)
    const data =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(data, data + size)
    texts.push((method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'))
    at +=
      46 +
      zip.readUInt16LE(at + 28) +
      zip.readUInt16LE(at + 30) +
      zip.readUInt16LE(at + 32)
  }
  return texts.join('\n')
}

const browser = {
  takeScreenshot: vi.fn().mockResolvedValue('shot')
} as unknown as WebdriverIO.Browser

afterEach(() => {
  clearTypedValues()
})

describe('a WebdriverIO trace', () => {
  it('holds no typed value a retried read returned', async () => {
    configureInputMasking()
    clearTypedValues()
    const capturer = new SessionCapturer()
    const run = (command: string, args: unknown[], result: unknown) =>
      capturer.afterCommand(
        browser,
        command as never,
        args,
        result,
        undefined,
        '/specs/login.ts:12:5'
      )
    await run('setValue', [SECRET], undefined)
    // One helper line reading the field twice is one retried row, replaced in the log in place.
    await run('getValue', [], SECRET)
    await run('getValue', [], SECRET)
    expect(
      capturer.commandsLog.filter((row) => row.command === 'getValue')
    ).toHaveLength(1)

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wdio-typed-'))
    const zipPath = await writeTraceZip(capturer, {
      outputDir,
      sessionId: 'login'
    })
    const text = await zipText(zipPath)
    expect(text).toContain('getValue')
    expect(text).not.toContain(SECRET)
  })
})
