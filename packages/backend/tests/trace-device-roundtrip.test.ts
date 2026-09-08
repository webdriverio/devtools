import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { TraceType, type Metadata } from '@wdio/devtools-shared'
import { writeTraceZip } from '@wdio/devtools-trace/trace-exporter'
import { afterEach, describe, expect, it } from 'vitest'

import { readTraceZip } from '../src/trace-reader.js'

/**
 * The writer lives in `trace` and the reader in `backend`, so no test proved
 * they agree about the device — and the device is the whole point: a native
 * capture normalizes `browserName` to `chromium` and reports the HOST OS as
 * `platform`, so before this field the player had nothing to tell a phone from
 * a desktop Chrome, and framed a portrait capture as a desktop window (#347).
 */
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

async function roundTrip(metadata: Metadata): Promise<Metadata> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-device-'))
  dirs.push(outputDir)
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        { command: 'click', args: ['~signIn'], timestamp: 2000, id: 1 }
      ],
      sources: new Map(),
      metadata,
      startWallTime: 1000
    },
    { outputDir, sessionId: 'abc12345' }
  )
  return (await readTraceZip(zip)).trace.metadata
}

describe('the device a capture was recorded on, written then read back', () => {
  it('survives the round trip from a device cloud session', async () => {
    const metadata = await roundTrip({
      type: TraceType.Testrunner,
      capabilities: {
        platformName: 'android',
        // Both the serial; only deviceModel is friendly.
        deviceName: '28111FDH200CUX',
        udid: '28111FDH200CUX',
        deviceModel: 'Pixel 7',
        platformVersion: '14'
      }
    })

    expect(metadata.device).toEqual({
      platform: 'android',
      name: 'Pixel 7',
      version: '14'
    })
    // And the platform is recoverable from capabilities again, which said only
    // `chromium` before.
    expect(metadata.capabilities).toEqual({
      browserName: 'chromium',
      platformName: 'android'
    })
  })

  it('survives it from a local iOS session', async () => {
    const metadata = await roundTrip({
      type: TraceType.Testrunner,
      capabilities: {
        platformName: 'iOS',
        'appium:deviceName': 'iPhone 17',
        'appium:platformVersion': '18.1'
      }
    })

    expect(metadata.device).toEqual({
      platform: 'ios',
      name: 'iPhone 17',
      version: '18.1'
    })
  })

  it('carries a viewport the session measured rather than the fallback', async () => {
    // 1080x2219 is what a Pixel 7 answers to getWindowSize — the window minus
    // its navigation bar. Without it the zip claimed the exporter's 1280x720.
    const metadata = await roundTrip({
      type: TraceType.Testrunner,
      capabilities: { platformName: 'android', deviceModel: 'Pixel 7' },
      viewport: {
        width: 1080,
        height: 2219,
        offsetLeft: 0,
        offsetTop: 0,
        scale: 1
      }
    })

    expect(metadata.viewport?.width).toBe(1080)
    expect(metadata.viewport?.height).toBe(2219)
  })

  it('leaves a desktop capture with no device at all', async () => {
    const metadata = await roundTrip({
      type: TraceType.Testrunner,
      capabilities: { browserName: 'firefox', browserVersion: '145' }
    })

    expect(metadata.device).toBeUndefined()
    expect(metadata.capabilities).toEqual({ browserName: 'firefox' })
  })
})
