import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { builtinModules } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TraceType } from '@wdio/devtools-shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bytesToBase64 } from '../src/base64.js'
import { writeTraceZip } from '../src/trace-exporter.js'
import { parseTraceZip } from '../src/trace-reader.js'

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

async function recordedZip(): Promise<Uint8Array> {
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
  it('parses a recorded trace with no Buffer in scope', async () => {
    const zip = await recordedZip()
    vi.stubGlobal('Buffer', undefined)

    const { frames, trace } = parseTraceZip(zip)

    expect(frames.map(({ screenshot }) => atob(screenshot))).toEqual([
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
    expect(bareImportsReachableFrom('read-trace-zip.ts')).toContain(
      'node:fs/promises'
    )
  })
})

describe('bytesToBase64', () => {
  const bytes = new Uint8Array(100_003).map((_, index) => (index * 31) % 256)
  const expected = Buffer.from(bytes).toString('base64')

  it('encodes through Buffer under Node', () => {
    expect(bytesToBase64(bytes)).toBe(expected)
  })

  it('encodes through btoa with neither native encoder', () => {
    vi.stubGlobal('Buffer', undefined)

    expect(bytesToBase64(bytes)).toBe(expected)
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })

  it('prefers the native encoder where the runtime has one', () => {
    const native = Object.assign(new Uint8Array([1]), {
      toBase64: () => 'native'
    })

    expect(bytesToBase64(native)).toBe('native')
  })
})
