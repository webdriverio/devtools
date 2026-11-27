import fs from 'node:fs/promises'
import type { TracePlayerData } from '@wdio/devtools-shared'
import {
  bytesZipSource,
  openTraceArchive,
  readTracePayload,
  type TraceArchive,
  type ZipSource
} from '@wdio/devtools-trace/trace-reader'
import {
  DEFAULT_MAX_INFLATED_BYTES,
  DEFAULT_MAX_ZIP_BYTES
} from './constants.js'
import { describeUrl, downloadTrace, httpsGet } from './download.js'
import { checkedFile, fileZipSource } from './file-source.js'
import { guardedRealPath } from './local-paths.js'
import { traceInFolder } from './output-folder.js'
import type {
  HttpGet,
  OpenedTrace,
  OpenTraceOptions,
  TraceHandle,
  TraceSelection,
  TraceTarget
} from './types.js'

/** What a query reads behind a handle: the parsed payload, the archive for entries read on demand, and the test it was opened for. */
export interface TraceState {
  data: TracePlayerData
  archive: TraceArchive
  test?: TraceSelection
}

// The payload's shape follows shared, so it stays behind the handle rather than on the published API.
const states = new WeakMap<TraceHandle, TraceState>()

const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i

async function handleFor(
  source: ZipSource,
  maxInflatedBytes: number,
  test?: TraceSelection
): Promise<TraceHandle> {
  const archive = await openTraceArchive(source)
  const data = await readTracePayload(archive, maxInflatedBytes)
  const handle = Object.freeze({}) as TraceHandle
  states.set(handle, { data, archive, ...(test ? { test } : {}) })
  return handle
}

/** Opens a trace zip from any byte source, reading only the entries the payload is built from. */
export function openTraceSource(
  source: ZipSource,
  options: Pick<OpenTraceOptions, 'maxInflatedBytes'> = {}
): Promise<TraceHandle> {
  return handleFor(
    source,
    options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES
  )
}

export function traceStateOf(handle: TraceHandle): TraceState {
  const state = states.get(handle)
  if (!state) {
    throw new Error('Not a trace handle: open the trace with openTraceSource')
  }
  return state
}

async function openLocal(
  location: string,
  options: OpenTraceOptions,
  target: TraceTarget | undefined
): Promise<OpenedTrace> {
  const roots = options.allowedRoots ?? []
  const real = await guardedRealPath(location, roots)
  const found = (await fs.stat(real)).isDirectory()
    ? await traceInFolder(real, target, roots)
    : { zipPath: real }
  const file = await checkedFile(found.zipPath, roots)
  const maxZipBytes = options.maxZipBytes ?? DEFAULT_MAX_ZIP_BYTES
  if (file.size > maxZipBytes) {
    throw new Error(
      `Cannot open ${file.path}: it is larger than the ${maxZipBytes}-byte limit`
    )
  }
  const handle = await handleFor(
    fileZipSource(file),
    options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES,
    found.test
  )
  return {
    handle,
    source: file.path,
    ...(found.test ? { test: found.test } : {})
  }
}

async function openRemote(
  location: URL,
  options: OpenTraceOptions,
  get: HttpGet
): Promise<OpenedTrace> {
  const bytes = await downloadTrace(
    location,
    {
      allowedHosts: options.allowedHosts ?? [],
      allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      maxZipBytes: options.maxZipBytes ?? DEFAULT_MAX_ZIP_BYTES
    },
    get
  )
  const handle = await handleFor(
    bytesZipSource(bytes),
    options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES
  )
  return { handle, source: describeUrl(location) }
}

/** `openTrace` with the https transport injected, so tests need no server. */
export function openTraceWith(
  location: string,
  options: OpenTraceOptions,
  target: TraceTarget | undefined,
  get: HttpGet
): Promise<OpenedTrace> {
  if (URL_SCHEME.test(location)) {
    return openRemote(new URL(location), options, get)
  }
  return openLocal(location, options, target)
}

/** Opens a trace from a local zip, a run's output folder (through its artifacts manifests), or an https URL such as a span's `devtools.artifact.url`. A target picks the test in a folder; a zip or URL opens whole. */
export function openTrace(
  location: string,
  options: OpenTraceOptions = {},
  target?: TraceTarget
): Promise<OpenedTrace> {
  return openTraceWith(
    location,
    options,
    target,
    httpsGet(options.allowPrivateNetwork ?? false)
  )
}
