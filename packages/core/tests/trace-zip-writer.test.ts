// The zip layout is a cross-package contract: `backend`'s reader matches entries
// by these names and cannot import this package to check. These tests pin the
// writer's output to `TRACE_ZIP_ENTRIES` in shared, so renaming an entry on one
// side fails here rather than when someone opens a real trace.

import { buildTraceZip, type TraceZipInputs } from '@wdio/devtools-core'
import { TRACE_ZIP_ENTRIES } from '@wdio/devtools-shared'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

function inputs(overrides: Partial<TraceZipInputs> = {}): TraceZipInputs {
  return {
    traceNdjson: '{"type":"before","callId":"call@1"}\n',
    networkNdjson: Buffer.from('{"startedDateTime":"2026-01-01T00:00:00Z"}\n'),
    resources: [],
    ...overrides
  }
}

const entriesOf = async (input: TraceZipInputs): Promise<string[]> =>
  Object.keys(unzipSync(new Uint8Array(await buildTraceZip(input)))).sort()

describe('buildTraceZip', () => {
  it('produces an archive the same unzip the reader uses can open', async () => {
    const zip = await buildTraceZip(inputs())
    expect(() => unzipSync(new Uint8Array(zip))).not.toThrow()
  })

  it('names the action stream and network stream per the shared contract', async () => {
    expect(await entriesOf(inputs())).toEqual([
      TRACE_ZIP_ENTRIES.network,
      TRACE_ZIP_ENTRIES.trace
    ])
  })

  it('round-trips the action stream bytes unchanged', async () => {
    const traceNdjson = '{"type":"after","callId":"call@1","endTime":5}\n'
    const files = unzipSync(
      new Uint8Array(await buildTraceZip(inputs({ traceNdjson })))
    )
    expect(Buffer.from(files[TRACE_ZIP_ENTRIES.trace]!).toString()).toBe(
      traceNdjson
    )
  })

  it('adds the transcript entry only when a transcript was built', async () => {
    expect(await entriesOf(inputs())).not.toContain(
      TRACE_ZIP_ENTRIES.transcript
    )
    expect(await entriesOf(inputs({ transcriptMd: '# Run\n' }))).toContain(
      TRACE_ZIP_ENTRIES.transcript
    )
  })

  it('adds the mutation stream only when mutations were captured', async () => {
    expect(
      await entriesOf(inputs({ mutationsNdjson: Buffer.alloc(0) }))
    ).not.toContain(TRACE_ZIP_ENTRIES.mutations)
    expect(
      await entriesOf(
        inputs({ mutationsNdjson: Buffer.from('{"type":"childList"}\n') })
      )
    ).toContain(TRACE_ZIP_ENTRIES.mutations)
  })

  it('writes resources under the shared resources directory', async () => {
    const entries = await entriesOf(
      inputs({
        resources: [
          { resourceName: 'page@1-1000.jpeg', data: Buffer.from([1, 2, 3]) },
          { resourceName: 'call@1-snapshot.txt', data: Buffer.from('hi') }
        ]
      })
    )
    expect(entries).toContain(
      `${TRACE_ZIP_ENTRIES.resourcesDir}/page@1-1000.jpeg`
    )
    expect(entries).toContain(
      `${TRACE_ZIP_ENTRIES.resourcesDir}/call@1-snapshot.txt`
    )
  })

  it('keeps resource bytes intact', async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const files = unzipSync(
      new Uint8Array(
        await buildTraceZip(
          inputs({ resources: [{ resourceName: 'shot.png', data }] })
        )
      )
    )
    expect(
      Buffer.from(files[`${TRACE_ZIP_ENTRIES.resourcesDir}/shot.png`]!).equals(
        data
      )
    ).toBe(true)
  })

  it('emits an empty network entry rather than omitting it', async () => {
    // The reader matches network streams by suffix and tolerates an empty body;
    // omitting the entry entirely would be a format change.
    const entries = await entriesOf(inputs({ networkNdjson: Buffer.alloc(0) }))
    expect(entries).toContain(TRACE_ZIP_ENTRIES.network)
  })
})
