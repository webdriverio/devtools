import type { TraceRunListing } from '@wdio/devtools-shared'

/** One trace zip to open: the path it was found at, and its bytes on demand. */
export interface TraceSource {
  path: string
  read: () => Promise<Blob>
}

export function isTraceZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip')
}

function fileSource(file: File, path = file.name): TraceSource {
  return { path, read: () => Promise.resolve(file) }
}

/** Picked files, or a picked folder's zips; a file picked by name is kept for the reader to refuse. */
export function sourcesFromFiles(files: Iterable<File>): TraceSource[] {
  const sources: TraceSource[] = []
  for (const file of files) {
    const relative = file.webkitRelativePath
    if (!relative) {
      sources.push(fileSource(file))
    } else if (isTraceZipName(file.name)) {
      sources.push(fileSource(file, relative))
    }
  }
  return sources.sort(byPath)
}

const byPath = (a: TraceSource, b: TraceSource): number =>
  a.path.localeCompare(b.path)

function isDirectory(
  entry: FileSystemEntry
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

function isFile(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

const fileOf = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject))

// A reader hands a directory over in batches, and an empty batch is the end.
async function childrenOf(dir: FileSystemDirectoryEntry) {
  const reader = dir.createReader()
  const children: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    )
    if (!batch.length) {
      return children
    }
    children.push(...batch)
  }
}

async function zipsUnder(
  dir: FileSystemDirectoryEntry
): Promise<TraceSource[]> {
  const sources: TraceSource[] = []
  for (const child of await childrenOf(dir)) {
    if (isDirectory(child)) {
      sources.push(...(await zipsUnder(child)))
    } else if (isFile(child) && isTraceZipName(child.name)) {
      sources.push(fileSource(await fileOf(child), child.fullPath.slice(1)))
    }
  }
  return sources
}

async function sourcesOfEntry(entry: FileSystemEntry): Promise<TraceSource[]> {
  if (isDirectory(entry)) {
    return zipsUnder(entry)
  }
  return isFile(entry) ? [fileSource(await fileOf(entry))] : []
}

/** A drop's files and folders; its entries are taken before any await, while the drop is still readable. */
export function sourcesFromDrop(
  transfer: DataTransfer | null | undefined
): Promise<TraceSource[]> {
  if (!transfer) {
    return Promise.resolve([])
  }
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))
  if (!entries.length) {
    return Promise.resolve(sourcesFromFiles(Array.from(transfer.files)))
  }
  return Promise.all(entries.map(sourcesOfEntry)).then((found) =>
    found.flat().sort(byPath)
  )
}

/** The zips `show-trace` lists, each fetched from the backend when it is read. */
export function sourcesFromListing(
  listing: TraceRunListing,
  fetchZip: typeof fetch = fetch
): TraceSource[] {
  return listing.traces.map(({ path, url }) => ({
    path,
    read: async () => {
      const response = await fetchZip(url)
      if (!response.ok) {
        throw new Error(`The player could not fetch it (${response.status})`)
      }
      return response.blob()
    }
  }))
}
