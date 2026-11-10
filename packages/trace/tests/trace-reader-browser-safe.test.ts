import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TraceType } from '@wdio/devtools-shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeTraceZip } from '../src/trace-exporter.js'
import { openTraceArchive, readTracePayload } from '../src/trace-reader.js'
import { bytesZipSource } from '../src/zip-index.js'

// The hosted trace player bundles the reader for the browser, and Vite only
// warns when it stubs a Node built-in, so the build alone would not catch one.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
const IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
const NODE_BUILTINS = new Set(builtinModules)

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(IMPORT_RE)].map((match) => match[1]!)
}

function bareImportsReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const bare = new Set<string>()
  const queue = [path.join(SRC, entry)]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith('.')) {
        queue.push(
          path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
        )
      } else {
        bare.add(specifier)
      }
    }
  }
  return bare
}

const dirs: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

async function recordedZip(): Promise<Uint8Array<ArrayBuffer>> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-safe-'))
  dirs.push(outputDir)
  const shot = Buffer.from('a screenshot').toString('base64')
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        {
          command: 'click',
          args: ['#login'],
          timestamp: 2000,
          screenshot: shot,
          callSource: '/specs/login.ts:4'
        }
      ],
      sources: new Map([['/specs/login.ts', 'it("logs in")']]),
      metadata: { type: TraceType.Testrunner },
      startWallTime: 1000
    },
    { outputDir, sessionId: 'abc12345' }
  )
  return new Uint8Array(await fs.readFile(zip))
}

describe('trace-reader in a browser', () => {
  // An import walk cannot see a Node global, which is how `Buffer` once
  // reached the hosted player and failed every trace with a screenshot.
  it('reads a recorded trace with no Buffer in scope', async () => {
    const zip = await recordedZip()
    vi.stubGlobal('Buffer', undefined)

    const archive = await openTraceArchive(bytesZipSource(new Uint8Array(zip)))
    const { frames, trace } = await readTracePayload(archive)

    const images = await Promise.all(
      frames.map(({ entry }) => archive.read(entry))
    )
    expect(images.map((image) => new TextDecoder().decode(image))).toEqual([
      'a screenshot'
    ])
    expect(trace.sources).toEqual({ '/specs/login.ts': 'it("logs in")' })
  })

  it('reaches no Node built-in', () => {
    const builtins = [...bareImportsReachableFrom('trace-reader.ts')].filter(
      (specifier) =>
        specifier.startsWith('node:') ||
        NODE_BUILTINS.has(specifier.split('/')[0]!)
    )
    expect(builtins).toEqual([])
  })

  it('detects one when it is there', () => {
    expect(bareImportsReachableFrom('trace-exporter.ts')).toContain(
      'node:fs/promises'
    )
  })
})
