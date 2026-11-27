import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import net from 'node:net'
import {
  DOWNLOAD_DEADLINE_MS,
  DOWNLOAD_IDLE_TIMEOUT_MS,
  MAX_REDIRECTS
} from './constants.js'
import {
  guardedLookup,
  isAllowedHost,
  isPrivateAddress
} from './network-guard.js'
import type { HttpGet, HttpResponse } from './types.js'

const REDIRECTS = new Set([301, 302, 303, 307, 308])

export interface DownloadLimits {
  allowedHosts: readonly string[]
  allowPrivateNetwork: boolean
  maxZipBytes: number
}

/** A URL as it may appear in a message: a presigned URL carries its credentials in the query string. */
export function describeUrl(url: URL): string {
  return `${url.origin}${url.pathname}`
}

function isDeadline(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  )
}

function refusal(url: URL, reason: string): Error {
  return new Error(`Cannot download ${describeUrl(url)}: ${reason}`)
}

// Node connects to an IP literal without calling the lookup, so the guard checks one here.
function checkUrl(url: URL, limits: DownloadLimits): void {
  if (url.protocol !== 'https:') {
    throw refusal(url, 'only https URLs are fetched')
  }
  if (!isAllowedHost(url, limits.allowedHosts)) {
    throw refusal(
      url,
      limits.allowedHosts.length === 0
        ? 'no allowed host is configured, so URLs are refused'
        : `${url.host} is not an allowed host (${limits.allowedHosts.join(', ')})`
    )
  }
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (
    !limits.allowPrivateNetwork &&
    net.isIP(literal) !== 0 &&
    isPrivateAddress(literal)
  ) {
    throw refusal(
      url,
      `${literal} is a local or private address; set allowPrivateNetwork to fetch from it`
    )
  }
}

async function readCapped(
  response: HttpResponse,
  url: URL,
  maxBytes: number
): Promise<Uint8Array> {
  const declared = response.contentLength
  if (declared !== undefined && declared > maxBytes) {
    response.discard()
    throw refusal(url, `it is larger than the ${maxBytes}-byte limit`)
  }
  // A declared length is allocated once, so the body is never held twice.
  let bytes = new Uint8Array(declared ?? Math.min(maxBytes, 1024 * 1024))
  let total = 0
  for await (const chunk of response.body) {
    if (total + chunk.byteLength > maxBytes) {
      response.discard()
      throw refusal(url, `it is larger than the ${maxBytes}-byte limit`)
    }
    if (total + chunk.byteLength > bytes.byteLength) {
      const grown = new Uint8Array(
        Math.min(
          maxBytes,
          Math.max(bytes.byteLength * 2, total + chunk.byteLength)
        )
      )
      grown.set(bytes.subarray(0, total))
      bytes = grown
    }
    bytes.set(chunk, total)
    total += chunk.byteLength
  }
  return bytes.subarray(0, total)
}

/** Downloads a trace zip over https from an allowed host, re-checking every redirect and capping its size. */
export async function downloadTrace(
  location: URL,
  limits: DownloadLimits,
  get: HttpGet
): Promise<Uint8Array> {
  // One deadline for the whole download, so a chain of slow redirects cannot extend it.
  const signal = AbortSignal.timeout(DOWNLOAD_DEADLINE_MS)
  let url = location
  for (let redirects = 0; ; redirects++) {
    checkUrl(url, limits)
    const response = await get(url, signal)
    if (REDIRECTS.has(response.status)) {
      response.discard()
      if (!response.location || redirects === MAX_REDIRECTS) {
        throw refusal(
          location,
          response.location
            ? `more than ${MAX_REDIRECTS} redirects`
            : 'a redirect named no location'
        )
      }
      url = new URL(response.location, url)
      continue
    }
    if (response.status !== 200) {
      response.discard()
      throw refusal(url, `HTTP ${response.status}`)
    }
    try {
      return await readCapped(response, url, limits.maxZipBytes)
    } catch (error) {
      throw isDeadline(error)
        ? refusal(url, `it did not finish within ${DOWNLOAD_DEADLINE_MS} ms`)
        : error
    }
  }
}

function responseOf(message: IncomingMessage): HttpResponse {
  const length = Number(message.headers['content-length'])
  return {
    status: message.statusCode ?? 0,
    location: message.headers.location,
    contentLength: Number.isFinite(length) ? length : undefined,
    body: message,
    discard: () => message.destroy()
  }
}

/** GET over node:https on a connection of its own (no proxy, no pooled socket the guard did not vet), connecting only to addresses the guard accepts. */
export function httpsGet(allowPrivateNetwork: boolean): HttpGet {
  const lookup = guardedLookup(allowPrivateNetwork)
  return (url, signal) =>
    new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          agent: false,
          lookup,
          timeout: DOWNLOAD_IDLE_TIMEOUT_MS,
          signal
        },
        (message) => resolve(responseOf(message))
      )
      request.on('timeout', () =>
        request.destroy(
          refusal(url, `nothing arrived for ${DOWNLOAD_IDLE_TIMEOUT_MS} ms`)
        )
      )
      request.on('error', (error) =>
        reject(
          isDeadline(error)
            ? refusal(
                url,
                `it did not finish within ${DOWNLOAD_DEADLINE_MS} ms`
              )
            : error
        )
      )
    })
}
