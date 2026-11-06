import { describe, expect, it, vi } from 'vitest'
import type { ReactiveControllerHost } from 'lit'
import type { CommandLog, TracePlayerData } from '@wdio/devtools-shared'

import type { TraceArchiveClient } from '../src/controller/trace-archive.js'
import {
  orderTraceRun,
  TraceRunController,
  type TraceRunEntry
} from '../src/controller/trace-run.js'
import type { TraceSource } from '../src/utils/trace-sources.js'
import { TRACE_OUTCOME, type TraceOutcome } from '../src/utils/trace-summary.js'

const host: ReactiveControllerHost = {
  addController() {},
  removeController() {},
  requestUpdate() {},
  updateComplete: Promise.resolve(true)
}

/** A parsed trace that reads as `outcome`, starting at `startTime`. */
function payload(outcome: TraceOutcome, startTime: number): TracePlayerData {
  const commands: CommandLog[] =
    outcome === TRACE_OUTCOME.UNKNOWN
      ? []
      : [
          {
            command: 'click',
            args: [],
            timestamp: startTime,
            ...(outcome === TRACE_OUTCOME.FAILED
              ? { error: { name: 'Error', message: 'boom' } }
              : {})
          }
        ]
  return {
    trace: { commands } as TracePlayerData['trace'],
    frames: [],
    startTime,
    duration: 1
  }
}

/** Each source's bytes are its path, so the fake parser can look the payload up. */
const source = (path: string): TraceSource => ({
  path,
  read: () => Promise.resolve(new Blob([path]))
})

function setup(byPath: Record<string, TracePlayerData | Error>) {
  const shown: TracePlayerData[] = []
  const archives: {
    path: string
    closed: boolean
    archive: TraceArchiveClient
  }[] = []
  const parse = vi.fn(async (bytes: Blob) => {
    const path = await bytes.text()
    const found = byPath[path]
    if (found instanceof Error) {
      throw found
    }
    const record = {
      path,
      closed: false,
      archive: {
        open: () => Promise.resolve(found),
        read: () => Promise.resolve(new Blob()),
        close: () => {
          record.closed = true
        }
      }
    }
    archives.push(record)
    return { data: found, archive: record.archive }
  })
  const handedOn: TraceArchiveClient[] = []
  const run = new TraceRunController(
    host,
    ({ data, archive }) => {
      shown.push(data)
      handedOn.push(archive)
    },
    parse
  )
  return { run, shown, parse, archives, handedOn }
}

const labels = (entries: readonly TraceRunEntry[]) =>
  entries.map(({ label }) => label)

describe('TraceRunController', () => {
  it('keeps only each zip’s summary, closing its archive once summarized', async () => {
    const { run, archives, handedOn } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })

    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    expect(run.entries.every((entry) => !('data' in entry))).toBe(true)
    // Two read for the list, then the failed one opened again to be shown.
    expect(archives.map(({ path, closed }) => [path, closed])).toEqual([
      ['a/trace.zip', true],
      ['b/trace.zip', true],
      ['b/trace.zip', false]
    ])
    expect(handedOn).toEqual([archives[2]!.archive])
  })

  it('opens a picked row’s zip again and hands its archive on', async () => {
    const passed = payload(TRACE_OUTCOME.PASSED, 1)
    const { run, shown, archives } = setup({
      'a/trace.zip': passed,
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    await run.select(0)

    expect(shown[shown.length - 1]).toBe(passed)
    expect(run.selectedId).toBe(0)
    expect(archives[archives.length - 1]).toMatchObject({
      path: 'a/trace.zip',
      closed: false
    })
  })

  it('closes a pick that a later pick overtook', async () => {
    const { run, shown, archives } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    await run.open([source('a/trace.zip'), source('b/trace.zip')])
    const before = shown.length

    const first = run.select(0)
    const second = run.select(1)
    await Promise.all([first, second])

    expect(shown.length).toBe(before + 1)
    expect(run.selectedId).toBe(1)
    expect(
      archives.filter(({ closed }) => !closed).map(({ path }) => path)
    ).toEqual(['b/trace.zip', 'b/trace.zip'])
  })

  it('keeps a row pickable when opening it again fails once', async () => {
    const passed = payload(TRACE_OUTCOME.PASSED, 1)
    const { run, shown } = setup({
      'a/trace.zip': passed,
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    let fail = false
    const flaky: TraceSource = {
      path: 'a/trace.zip',
      read: () =>
        fail
          ? Promise.reject(new Error('gone for now'))
          : Promise.resolve(new Blob(['a/trace.zip']))
    }
    await run.open([flaky, source('b/trace.zip')])

    fail = true
    await run.select(0)
    expect(run.entries[0]!.status).toBe('ready')
    expect(run.selectedId).toBe(1)
    expect(run.error).toBe('Could not open a/trace.zip: gone for now')

    fail = false
    await run.select(0)
    expect(run.selectedId).toBe(0)
    expect(run.error).toBeUndefined()
    expect(shown[shown.length - 1]).toBe(passed)
  })

  it('leaves the selection to a pick made while the previous one was still showing', async () => {
    const shown: string[] = []
    let releaseFirst!: () => void
    const firstShown = new Promise<void>((resolve) => (releaseFirst = resolve))
    const run = new TraceRunController(
      host,
      ({ data }) => {
        shown.push(String(data.startTime))
        return data.startTime === 1 ? firstShown : undefined
      },
      async (bytes) => ({
        data: payload(
          TRACE_OUTCOME.PASSED,
          (await bytes.text()) === 'a' ? 1 : 2
        ),
        archive: { open: vi.fn(), read: vi.fn(), close: () => {} }
      })
    )
    const sources = [source('a'), source('b')]
    const opening = run.open(sources)
    await vi.waitFor(() => expect(shown).toEqual(['1']))

    await run.select(1)
    releaseFirst()
    await opening

    expect(run.selectedId).toBe(1)
  })

  it('drops a pick still opening once something else is opened', async () => {
    const { run, shown } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    await run.open([source('a/trace.zip'), source('b/trace.zip')])
    const before = shown.length

    const pick = run.select(0)
    run.cancelPending()
    await pick

    expect(shown.length).toBe(before)
  })

  it('reads every zip once and lists each one with its outcome', async () => {
    const { run, parse } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })

    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    // The list reads each once; the one played first is opened again to show it.
    expect(parse).toHaveBeenCalledTimes(3)
    expect(
      run.ordered.map((entry) =>
        entry.status === 'ready' ? entry.summary.outcome : entry.status
      )
    ).toEqual([TRACE_OUTCOME.FAILED, TRACE_OUTCOME.PASSED])
  })

  it('lists a zip it could not read with the reason, and reads the rest', async () => {
    const { run } = setup({
      'a/trace.zip': new Error('Not a readable trace: bad zip'),
      'b/trace.zip': payload(TRACE_OUTCOME.PASSED, 2)
    })

    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    const [unreadable, passed] = run.ordered
    expect(unreadable).toMatchObject({
      label: 'a',
      status: 'error',
      error: 'Not a readable trace: bad zip'
    })
    expect(passed.status).toBe('ready')
  })

  it('isolates a zip whose bytes could not be fetched', async () => {
    const { run } = setup({ 'b/trace.zip': payload(TRACE_OUTCOME.PASSED, 2) })

    await run.open([
      { path: 'a/trace.zip', read: () => Promise.reject(new Error('gone')) },
      source('b/trace.zip')
    ])

    expect(run.entries.map(({ status }) => status)).toEqual(['error', 'ready'])
  })

  it('plays the top of the list once every zip is read', async () => {
    const failed = payload(TRACE_OUTCOME.FAILED, 5)
    const { run, shown } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': failed
    })

    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    expect(shown).toEqual([failed])
    expect(run.selectedId).toBe(1)
  })

  it('keeps a row picked while the rest were still being read', async () => {
    const passed = payload(TRACE_OUTCOME.PASSED, 1)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { run, shown } = setup({
      'a/trace.zip': passed,
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    const opened = run.open([
      source('a/trace.zip'),
      {
        path: 'b/trace.zip',
        read: () => gate.then(() => new Blob(['b/trace.zip']))
      }
    ])
    await vi.waitFor(() => expect(run.entries[0].status).toBe('ready'))

    await run.select(0)
    release()
    await opened

    expect(shown).toEqual([passed])
    expect(run.selectedId).toBe(0)
  })

  it('lists rows as found while reading, so they do not move under the pointer', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { run } = setup({
      'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1),
      'b/trace.zip': payload(TRACE_OUTCOME.FAILED, 2)
    })
    const opened = run.open([
      source('a/trace.zip'),
      {
        path: 'b/trace.zip',
        read: () => gate.then(() => new Blob(['b/trace.zip']))
      }
    ])
    await vi.waitFor(() => expect(run.entries[0].status).toBe('ready'))

    expect(run.loading).toBe(true)
    expect(labels(run.ordered)).toEqual(['a', 'b'])

    release()
    await opened
    expect(labels(run.ordered)).toEqual(['b', 'a'])
  })

  it('ignores a row that has nothing to play', async () => {
    const { run, shown } = setup({ 'a/trace.zip': new Error('bad zip') })
    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    await run.select(0)

    expect(shown).toEqual([])
    expect(run.selectedId).toBeUndefined()
  })

  it('drops a run that a newer open replaced before it finished', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const newer = payload(TRACE_OUTCOME.PASSED, 9)
    const { run, shown } = setup({
      'old/trace.zip': payload(TRACE_OUTCOME.FAILED, 1),
      'new/trace.zip': newer,
      'new2/trace.zip': payload(TRACE_OUTCOME.PASSED, 10)
    })
    const stale = run.open([
      {
        path: 'old/trace.zip',
        read: () => gate.then(() => new Blob(['old/trace.zip']))
      },
      source('new/trace.zip')
    ])

    await run.open([source('new/trace.zip'), source('new2/trace.zip')])
    release()
    await stale

    expect(labels(run.entries)).toEqual(['new', 'new2'])
    expect(shown).toEqual([newer])
  })

  it('is inactive once cleared', async () => {
    const { run } = setup({ 'a/trace.zip': payload(TRACE_OUTCOME.PASSED, 1) })
    await run.open([source('a/trace.zip'), source('b/trace.zip')])

    run.clear()

    expect(run.active).toBe(false)
    expect(run.selectedId).toBeUndefined()
  })
})

describe('orderTraceRun', () => {
  const ready = (
    id: number,
    outcome: TraceOutcome,
    startTime: number
  ): TraceRunEntry => ({
    id,
    path: `${id}`,
    label: `${id}`,
    status: 'ready',
    summary: { outcome, startTime }
  })

  it('puts failures first, then unreadable zips, unknown and passed, each in run order', () => {
    const ordered = orderTraceRun([
      ready(0, TRACE_OUTCOME.PASSED, 1),
      ready(1, TRACE_OUTCOME.FAILED, 30),
      { id: 2, path: '2', label: '2', status: 'error', error: 'bad zip' },
      ready(3, TRACE_OUTCOME.UNKNOWN, 2),
      ready(4, TRACE_OUTCOME.FAILED, 10),
      ready(5, TRACE_OUTCOME.PASSED, 0)
    ])

    expect(ordered.map(({ id }) => id)).toEqual([4, 1, 2, 3, 5, 0])
  })
})
