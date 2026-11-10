// Time-to-payload, peak memory and posted payload size of the trace reader on one zip, reading only the payload's entries against a whole-zip read that base64s every frame (the cost of a payload that carries its images).
// Usage: pnpm --filter @wdio/devtools-trace measure:reader <trace.zip | --synthetic>

import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import v8 from 'node:v8'

import { unzipSync } from 'fflate'
import { nearestFrame } from '@wdio/devtools-shared'

import {
  openTraceArchive,
  parseTraceZip,
  readTracePayload
} from '../src/trace-reader.js'
import { bytesZipSource } from '../src/zip-index.js'
import { syntheticTraceZip } from './synthetic-trace.js'

type Mode = 'whole' | 'on-demand'

const MB = 1024 * 1024

/** Every entry inflated and every image carried as base64, the cost of a payload that held its images. */
function readWhole(zip: Uint8Array): unknown {
  const entries = unzipSync(zip)
  const data = parseTraceZip(zip)
  const frames = data.frames.map((frame) => ({
    timestamp: frame.timestamp,
    screenshot: Buffer.from(entries[frame.entry]!).toString('base64')
  }))
  for (const command of data.trace.commands) {
    command.screenshot = nearestFrame(frames, command.timestamp)?.screenshot
  }
  return { ...data, frames }
}

async function readOnDemand(zip: Uint8Array): Promise<unknown> {
  return readTracePayload(await openTraceArchive(bytesZipSource(zip)))
}

/** One mode in this process: what a worker builds and posts, then the peak resident size it took. */
async function measureMode(mode: Mode, zipPath: string): Promise<void> {
  const zip = new Uint8Array(await fs.readFile(zipPath))
  const start = performance.now()
  const payload = mode === 'whole' ? readWhole(zip) : await readOnDemand(zip)
  const posted = v8.serialize(payload).byteLength
  const ms = performance.now() - start
  const peakMb = process.resourceUsage().maxRSS / 1024
  process.stdout.write(JSON.stringify({ ms, peakMb, posted }))
}

function runChild(mode: Mode, zipPath: string) {
  const child = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      '--mode',
      mode,
      zipPath
    ],
    { encoding: 'utf8' }
  )
  if (child.status !== 0) {
    throw new Error(child.stderr)
  }
  return JSON.parse(child.stdout) as {
    ms: number
    peakMb: number
    posted: number
  }
}

async function main(args: string[]): Promise<void> {
  if (args[0] === '--mode') {
    return measureMode(args[1] as Mode, args[2]!)
  }
  const [given] = args
  if (!given) {
    throw new Error('Usage: measure-reader <trace.zip | --synthetic>')
  }
  const synthetic =
    given === '--synthetic'
      ? await fs.mkdtemp(path.join(os.tmpdir(), 'reader-'))
      : undefined
  const zipPath = synthetic ? path.join(synthetic, 'synthetic.zip') : given
  try {
    if (synthetic) {
      await fs.writeFile(zipPath, await syntheticTraceZip())
    }
    const size = (await fs.stat(zipPath)).size
    const whole = runChild('whole', zipPath)
    const lazy = runChild('on-demand', zipPath)
    const fmt = (r: typeof whole) =>
      `${r.ms.toFixed(0)} ms, ${r.peakMb.toFixed(0)} MB peak RSS, ${(r.posted / MB).toFixed(2)} MB posted`
    console.log(
      `${path.basename(zipPath)} (${(size / MB).toFixed(1)} MB): whole ${fmt(whole)}; on demand ${fmt(lazy)}`
    )
  } finally {
    if (synthetic) {
      await fs.rm(synthetic, { recursive: true, force: true })
    }
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
