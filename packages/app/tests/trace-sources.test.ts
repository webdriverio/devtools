// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { traceZipUrl } from '@wdio/devtools-shared'

import {
  isTraceZipName,
  sourcesFromDrop,
  sourcesFromFiles,
  sourcesFromListing,
  type TraceSource
} from '../src/utils/trace-sources.js'

/** A file in a dropped tree; partial, holding only what the walker reads, hence the cast. */
function fileEntry(fullPath: string): FileSystemFileEntry {
  const name = fullPath.split('/').pop()!
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (resolve: (file: File) => void) => resolve(new File([name], name))
  } as unknown as FileSystemFileEntry
}

/** A folder whose reader hands its children over in batches, as the real one may; partial, hence the cast. */
function dirEntry(
  fullPath: string,
  batches: FileSystemEntry[][]
): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').pop()!,
    fullPath,
    createReader: () => {
      const pending = [...batches, []]
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) =>
          resolve(pending.shift() ?? [])
      }
    }
  } as unknown as FileSystemDirectoryEntry
}

// Partial: a drop's items and files are all the walker reads.
function drop(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files
  } as unknown as DataTransfer
}

const paths = (sources: TraceSource[]) => sources.map(({ path }) => path)

describe('isTraceZipName', () => {
  it('matches a zip whatever the case of its suffix', () => {
    expect(isTraceZipName('trace.ZIP')).toBe(true)
    expect(isTraceZipName('trace.zip.png')).toBe(false)
  })
})

describe('sourcesFromFiles', () => {
  it('keeps a file picked by name even when it is not a zip, for the reader to refuse', () => {
    expect(paths(sourcesFromFiles([new File([''], 'notes.txt')]))).toEqual([
      'notes.txt'
    ])
  })

  it('lists picked files in path order', () => {
    expect(
      paths(
        sourcesFromFiles([new File([''], 'b.zip'), new File([''], 'a.zip')])
      )
    ).toEqual(['a.zip', 'b.zip'])
  })
})

describe('sourcesFromDrop', () => {
  it('walks dropped folders for their zips and ignores everything else', async () => {
    const run = dirEntry('/run', [
      [
        dirEntry('/run/login-chrome', [
          [fileEntry('/run/login-chrome/trace.zip')],
          [fileEntry('/run/login-chrome/video.webm')]
        ]),
        fileEntry('/run/artifacts.json')
      ],
      [
        dirEntry('/run/logout-chrome', [
          [fileEntry('/run/logout-chrome/trace.zip')]
        ])
      ]
    ])

    const sources = await sourcesFromDrop(drop([run]))

    expect(paths(sources)).toEqual([
      'run/login-chrome/trace.zip',
      'run/logout-chrome/trace.zip'
    ])
    expect((await sources[0].read()).size).toBeGreaterThan(0)
  })

  it('keeps a file dropped on its own, beside a folder', async () => {
    const sources = await sourcesFromDrop(
      drop([fileEntry('/other.zip'), dirEntry('/empty', [])])
    )

    expect(paths(sources)).toEqual(['other.zip'])
  })

  it('takes the entries before it awaits anything, while the drop is still readable', () => {
    const getAsEntry = vi.fn(() => fileEntry('/a.zip'))
    const transfer = {
      items: [{ webkitGetAsEntry: getAsEntry }],
      files: []
    } as unknown as DataTransfer

    void sourcesFromDrop(transfer)

    expect(getAsEntry).toHaveBeenCalled()
  })

  it('falls back to the dropped files where the browser has no entry API', async () => {
    const transfer = {
      items: [{}],
      files: [new File([''], 'trace.zip')]
    } as unknown as DataTransfer

    expect(paths(await sourcesFromDrop(transfer))).toEqual(['trace.zip'])
  })

  it('is empty for a drop with nothing in it', async () => {
    expect(await sourcesFromDrop(undefined)).toEqual([])
  })
})

describe('sourcesFromListing', () => {
  const listing = {
    traces: [{ path: 'run/a/trace.zip', url: traceZipUrl(0) }]
  }

  it('fetches a listed zip only when it is read', async () => {
    const fetchZip = vi.fn(() =>
      Promise.resolve(new Response(new Blob(['zip'])))
    )

    const [source] = sourcesFromListing(listing, fetchZip)
    expect(fetchZip).not.toHaveBeenCalled()

    expect(await (await source.read()).text()).toBe('zip')
    expect(fetchZip).toHaveBeenCalledWith('/api/trace/zip/0')
  })

  it('fails a read the backend refused', async () => {
    const [source] = sourcesFromListing(listing, () =>
      Promise.resolve(new Response(null, { status: 404 }))
    )

    await expect(source.read()).rejects.toThrow('(404)')
  })
})
