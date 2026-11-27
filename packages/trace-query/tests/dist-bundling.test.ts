// @wdio/mcp consumes only the built dist, where a leaked private import or a CJS require shim crashes on import and no source test notices; gated on the build having run.

import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type * as TraceQuery from '../src/index.js'

const DIST = new URL('../dist/', import.meta.url)
const ENTRY = new URL('index.js', DIST)
const built = fs.existsSync(ENTRY)

const FIXTURE = new URL(
  '../../trace/tests/fixtures/trace-formats/wdio-mocha-2026-11-10-ee505b9c.zip',
  import.meta.url
)

describe('trace-query dist', () => {
  it.skipIf(!built)('imports no private workspace package', () => {
    const leaks = fs
      .readdirSync(DIST)
      .filter((file) => file.endsWith('.js'))
      .filter((file) =>
        /(?:from|import\(|require\()\s*['"](?:@wdio\/devtools-(?:core|shared|trace)['"/]|(?:\.\.\/)+packages\/)/.test(
          fs.readFileSync(new URL(file, DIST), 'utf8')
        )
      )
    expect(leaks).toEqual([])
  })

  it.skipIf(!built)('carries no require shim', () => {
    expect(fs.readFileSync(ENTRY, 'utf8')).not.toContain('Dynamic require of')
  })

  it.skipIf(!built)('opens a trace through the built entry', async () => {
    const { bytesZipSource, openTraceSource } = (await import(
      ENTRY.href
    )) as typeof TraceQuery
    await expect(
      openTraceSource(bytesZipSource(new Uint8Array(fs.readFileSync(FIXTURE))))
    ).resolves.toBeDefined()
    await expect(
      openTraceSource(bytesZipSource(new TextEncoder().encode('not a zip')))
    ).rejects.toThrow('Not a zip archive')
  })
})
