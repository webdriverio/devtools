import {
  TRACE_DOWNLOAD_IDLE_TIMEOUT_MS,
  TRACE_DOWNLOAD_MAX_BYTES
} from './constants.js'

// A local file header, or the end record an empty archive starts with.
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06]
]

const MEGABYTE = 1024 * 1024

export interface TraceDownloadOptions {
  /** The player page; a same-origin URL is accepted over its own scheme. */
  page: URL
  fetch?: typeof fetch
  maxBytes?: number
  idleTimeoutMs?: number
}

/** True for an https URL, or one on the page's own http origin; never `data:`, `blob:`, `file:` or `javascript:`. */
function isAllowedTraceUrl(url: URL, page: URL): boolean {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && url.origin === page.origin)
  )
}

/** The URL `?trace=` names, resolved against the page; throws why it cannot be opened. */
export function traceUrlFrom(raw: string, page: URL): URL {
  let url: URL
  try {
    url = new URL(raw, page)
  } catch {
    throw new Error('The trace parameter is not a URL')
  }
  if (!isAllowedTraceUrl(url, page)) {
    throw new Error(
      `Only https URLs can be opened, and this one is ${url.protocol}`
    )
  }
  if (url.username || url.password) {
    throw new Error('A trace URL cannot carry a user name or password')
  }
  return url
}

const tooLarge = (maxBytes: number): Error =>
  new Error(
    `The trace is larger than the ${Math.round(maxBytes / MEGABYTE)} MB the player downloads`
  )

const notAZip = (host: string): Error =>
  new Error(`What ${host} served is not a zip archive`)

function startsAsZip(head: Uint8Array): boolean {
  return ZIP_SIGNATURES.some((signature) =>
    signature.every((byte, i) => head[i] === byte)
  )
}

class Stalled extends Error {}

/** Settles as `work` does, unless it takes longer than `ms`; then `onStall` runs and it rejects. */
async function withinIdle<T>(
  work: Promise<T>,
  ms: number,
  onStall: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<never>((_, reject) => {
    // Rejected first: cancelling a reader settles its pending read as done, which would win the race.
    timer = setTimeout(() => {
      reject(new Stalled())
      onStall()
    }, ms)
  })
  try {
    return await Promise.race([work, stalled])
  } finally {
    clearTimeout(timer)
  }
}

interface ReadLimits {
  maxBytes: number
  idleTimeoutMs: number
  host: string
  abort: () => void
}

/** The body's chunks, refusing it as soon as it starts as something other than a zip or grows past the cap. */
async function readZipBody(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  { maxBytes, idleTimeoutMs, host, abort }: ReadLimits
): Promise<Uint8Array<ArrayBuffer>[]> {
  const reader = body.getReader()
  const stop = () => {
    abort()
    void reader.cancel().catch(() => {})
  }
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  for (;;) {
    const chunk = await withinIdle(reader.read(), idleTimeoutMs, stop).catch(
      (error: unknown) => {
        throw error instanceof Stalled
          ? error
          : new Error(`The download from ${host} was interrupted`)
      }
    )
    if (chunk.done) {
      if (total < 4) {
        throw notAZip(host)
      }
      return chunks
    }
    const before = total
    total += chunk.value.byteLength
    chunks.push(chunk.value)
    if (total > maxBytes) {
      stop()
      throw tooLarge(maxBytes)
    }
    if (before < 4 && total >= 4 && !startsAsZip(concatHead(chunks))) {
      stop()
      throw notAZip(host)
    }
  }
}

function concatHead(chunks: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(4)
  let filled = 0
  for (const chunk of chunks) {
    const take = chunk.subarray(0, 4 - filled)
    head.set(take, filled)
    filled += take.byteLength
    if (filled === 4) {
      break
    }
  }
  return head
}

async function requestZip(
  url: URL,
  fetchZip: typeof fetch,
  idleTimeoutMs: number,
  controller: AbortController
): Promise<Response> {
  try {
    return await withinIdle(
      fetchZip(url, {
        credentials: 'omit',
        redirect: 'follow',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      }),
      idleTimeoutMs,
      () => controller.abort()
    )
  } catch (error) {
    // Releases a refused response's body as well as a stalled one.
    controller.abort()
    if (error instanceof Stalled) {
      throw error
    }
    throw new Error(
      `The request to ${url.host} failed: the host must be reachable and send an Access-Control-Allow-Origin header that admits this page`
    )
  }
}

function checkResponse(response: Response, url: URL, page: URL, max: number) {
  if (response.url && !isAllowedTraceUrl(new URL(response.url), page)) {
    throw new Error(`${url.host} redirected to a URL that is not https`)
  }
  if (!response.ok) {
    const status = [response.status, response.statusText]
      .filter(Boolean)
      .join(' ')
    // A signed URL cut at its own `&` reads as unauthorized, so say how to pass one whole.
    const hint =
      response.status >= 400 && response.status < 500
        ? '; a URL with its own query must be the last parameter, after `trace=`, or percent-encoded'
        : ''
    throw new Error(`${url.host} answered ${status}${hint}`)
  }
  if (Number(response.headers.get('content-length')) > max) {
    throw tooLarge(max)
  }
}

/** Downloads the zip at `url` without credentials, refusing a redirect off https, a failed status, a stalled or oversize body and anything that is not a zip. */
export async function downloadTrace(
  url: URL,
  {
    page,
    fetch: fetchZip = fetch,
    maxBytes = TRACE_DOWNLOAD_MAX_BYTES,
    idleTimeoutMs = TRACE_DOWNLOAD_IDLE_TIMEOUT_MS
  }: TraceDownloadOptions
): Promise<Blob> {
  const controller = new AbortController()
  try {
    const response = await requestZip(url, fetchZip, idleTimeoutMs, controller)
    checkResponse(response, url, page, maxBytes)
    const body = response.body ?? new Response(await response.blob()).body
    if (!body) {
      throw notAZip(url.host)
    }
    const chunks = await readZipBody(body, {
      maxBytes,
      idleTimeoutMs,
      host: url.host,
      abort: () => controller.abort()
    })
    return new Blob(chunks, { type: 'application/zip' })
  } catch (error) {
    // Releases a refused response's body as well as a stalled one.
    controller.abort()
    if (error instanceof Stalled) {
      throw new Error(
        `${url.host} sent nothing for ${Math.round(idleTimeoutMs / 1000)} s, so the download was stopped`
      )
    }
    throw error
  }
}
