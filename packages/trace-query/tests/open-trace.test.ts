import { describe, expect, it } from 'vitest'
import { bytesZipSource } from '@wdio/devtools-trace/trace-reader'
import { openTraceSource, traceStateOf } from '../src/open-trace.js'
import type { TraceHandle } from '../src/types.js'
import { fixtures, openFixture as open } from './traces.js'

describe('openTraceSource', () => {
  it('has a fixture to open', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it.each(fixtures)(
    'opens $zipName with every action it holds',
    async ({ zipName, manifest }) => {
      const { data } = traceStateOf(await open(zipName))
      expect(data.trace.commands).toHaveLength(manifest.commands.count)
      expect(data.trace.consoleLogs).toHaveLength(manifest.consoleLogs)
    }
  )

  it.each(fixtures.filter(({ manifest }) => manifest.frames.length > 0))(
    'reads a frame image of $zipName on demand',
    async ({ zipName }) => {
      const { data, archive } = traceStateOf(await open(zipName))
      const entry = data.frames[0]!.entry
      expect(archive.sizeOf(entry)).toBeGreaterThan(0)
      expect((await archive.read(entry)).byteLength).toBeGreaterThan(0)
    }
  )

  it('rejects an entry the zip does not hold', async () => {
    const { archive } = traceStateOf(await open(fixtures[0]!.zipName))
    await expect(archive.read('resources/missing.png')).rejects.toThrow(
      'The trace has no entry resources/missing.png'
    )
  })

  it('refuses bytes that are not a zip', async () => {
    await expect(
      openTraceSource(bytesZipSource(new TextEncoder().encode('not a zip')))
    ).rejects.toThrow('Not a zip archive')
  })

  it('hands out a handle that exposes nothing', async () => {
    const handle = await open(fixtures[0]!.zipName)
    expect(Object.keys(handle)).toEqual([])
    expect(Object.isFrozen(handle)).toBe(true)
  })

  it('refuses a handle it did not open', () => {
    expect(() => traceStateOf({} as TraceHandle)).toThrow(
      'Not a trace handle: open the trace with openTraceSource'
    )
  })
})
