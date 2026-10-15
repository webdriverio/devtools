import type { Collector } from './collector.js'
import type { NetworkRequest } from '../../types.js'
import { resourceTimingUrl, shouldIgnoreRequest } from './network-helpers.js'

/** A Resource Timing entry under a claimed URL that started within this many
 *  ms of the claim is the same request, seen from the other side. */
const CLAIM_TOLERANCE_MS = 1000

/** Claims a long-polling page could accumulate between two drains; the oldest
 *  are the ones whose entries have long since arrived. */
const MAX_CLAIMS = 500

interface Claim {
  url: string
  startTime: number
  /** The patch recorded the call; the entry still to arrive is a second listing. */
  recorded?: boolean
  /** The entry arrived first and waits for the patch to record or drop the call. */
  held?: NetworkRequest
}

export class NetworkRequestCollector implements Collector<NetworkRequest> {
  #requests: NetworkRequest[] = []
  #pendingRequests = new Map<string, Partial<NetworkRequest>>()
  #pendingXHRRequests = new WeakMap<XMLHttpRequest, Partial<NetworkRequest>>()
  /** Every fetch/XHR this patch has seen start, so the Resource Timing
   *  collector can tell its own entry for the same request apart from a load
   *  nobody else recorded. Survives `clear()`: the entry can arrive after the
   *  drain that took the patched record. A call this patch drops gives the
   *  entry it held back, so the request keeps its one record. */
  #claims: Claim[] = []
  #originalFetch?: typeof fetch
  #originalXhrOpen?: typeof XMLHttpRequest.prototype.open
  #originalXhrSend?: typeof XMLHttpRequest.prototype.send

  constructor() {
    this.#patchFetch()
    this.#patchXHR()
  }

  getArtifacts(): NetworkRequest[] {
    return this.#requests
  }

  clear(): void {
    this.#requests = []
    this.#pendingRequests.clear()
  }

  /** Whether this patch saw a request for `url` start within tolerance of
   *  `startTime`. The entry is taken: either the call is already recorded and
   *  the entry would be its second listing, or the entry is held until the
   *  patch records or drops the call. A page polling one URL matches each
   *  entry to one call. */
  consumeClaim(url: string, startTime: number, entry: NetworkRequest): boolean {
    const claim = this.#nearestClaim(url, startTime)
    if (!claim) {
      return false
    }
    if (claim.recorded) {
      this.#dropClaim(claim)
    } else {
      claim.held = entry
    }
    return true
  }

  #nearestClaim(url: string, startTime: number): Claim | undefined {
    let best: Claim | undefined
    let bestDelta = CLAIM_TOLERANCE_MS
    for (const claim of this.#claims) {
      const delta = Math.abs(claim.startTime - startTime)
      if (claim.url === url && !claim.held && delta <= bestDelta) {
        best = claim
        bestDelta = delta
      }
    }
    return best
  }

  #claim(url: string, startTime: number): Claim {
    const claim = { url: resourceTimingUrl(url), startTime }
    this.#claims.push(claim)
    if (this.#claims.length > MAX_CLAIMS) {
      this.#claims.shift()
    }
    return claim
  }

  /** The call was recorded: an entry already held is its second listing. */
  #settleClaim(claim: Claim): void {
    if (claim.held) {
      this.#dropClaim(claim)
    } else {
      claim.recorded = true
    }
  }

  /** The call was dropped: an entry already held becomes the request's record. */
  #releaseClaim(claim: Claim): void {
    if (claim.held) {
      this.#requests.push(claim.held)
    }
    this.#dropClaim(claim)
  }

  #dropClaim(claim: Claim): void {
    const index = this.#claims.indexOf(claim)
    if (index !== -1) {
      this.#claims.splice(index, 1)
    }
  }

  #generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  #extractFetchUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') {
      return input
    }
    return input instanceof URL ? input.href : input.url
  }

  async #readResponseBody(
    response: Response,
    contentType: string
  ): Promise<string | undefined> {
    try {
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/')
      ) {
        return await response.clone().text()
      }
    } catch {
      /* ignore body read errors */
    }
    return undefined
  }

  /** Whether the response is one this patch records: a content-type-less
   *  response (a 204, a redirect target) is left to Resource Timing. */
  async #recordFetchResponse(
    id: string,
    request: Partial<NetworkRequest>,
    response: Response,
    startTime: number
  ): Promise<boolean> {
    const endTime = performance.now()
    const responseHeaders = this.#extractHeaders(response.headers)
    const contentType = responseHeaders['content-type']?.trim()
    if (!contentType || contentType === '-') {
      this.#pendingRequests.delete(id)
      return false
    }
    const responseBody = await this.#readResponseBody(response, contentType)
    this.#requests.push({
      id,
      url: request.url!,
      method: request.method!,
      status: response.status,
      statusText: response.statusText,
      type: 'fetch',
      timestamp: request.timestamp!,
      startTime,
      endTime,
      time: endTime - startTime,
      requestHeaders: request.requestHeaders,
      responseHeaders,
      requestBody: request.requestBody,
      responseBody,
      size: this.#estimateSize(responseBody)
    })
    this.#pendingRequests.delete(id)
    return true
  }

  #patchFetch() {
    if (typeof window.fetch !== 'function') {
      return
    }
    this.#originalFetch = window.fetch
    const self = this
    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = self.#extractFetchUrl(input)
      if (shouldIgnoreRequest(url)) {
        return self.#originalFetch!.apply(this, [input, init])
      }
      const id = self.#generateId()
      const startTime = performance.now()
      const claim = self.#claim(url, startTime)
      const request: Partial<NetworkRequest> = {
        id,
        url,
        method: init?.method?.toUpperCase() || 'GET',
        type: 'fetch',
        timestamp: Date.now(),
        startTime,
        requestHeaders: init?.headers ? self.#extractHeaders(init.headers) : {},
        requestBody: init?.body ? String(init.body) : undefined
      }
      self.#pendingRequests.set(id, request)
      try {
        const response = await self.#originalFetch!.apply(this, [input, init])
        const recorded = await self.#recordFetchResponse(
          id,
          request,
          response,
          startTime
        )
        if (recorded) {
          self.#settleClaim(claim)
        } else {
          self.#releaseClaim(claim)
        }
        return response
      } catch (error) {
        self.#pendingRequests.delete(id)
        self.#releaseClaim(claim)
        throw error
      }
    }
  }

  #recordXHRResponse(
    xhr: XMLHttpRequest,
    requestData: Partial<NetworkRequest>,
    startTime: number
  ): boolean {
    const endTime = performance.now()
    const responseHeaders = this.#extractXHRHeaders(xhr)
    const contentType = responseHeaders['content-type']?.trim()
    if (!contentType || contentType === '-') {
      return false
    }
    let responseBody: string | undefined
    try {
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/')
      ) {
        responseBody = xhr.responseText
      }
    } catch {
      /* ignore body read errors */
    }
    this.#requests.push({
      id: requestData.id!,
      url: requestData.url!,
      method: requestData.method!,
      status: xhr.status,
      statusText: xhr.statusText,
      type: 'xhr',
      timestamp: requestData.timestamp!,
      startTime,
      endTime,
      time: endTime - startTime,
      requestHeaders: requestData.requestHeaders,
      responseHeaders,
      requestBody: requestData.requestBody,
      responseBody,
      size: this.#estimateSize(responseBody)
    })
    return true
  }

  #patchXHROpen(self: this): void {
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const urlString = typeof url === 'string' ? url : url.href
      if (!shouldIgnoreRequest(urlString)) {
        self.#pendingXHRRequests.set(this, {
          id: self.#generateId(),
          url: urlString,
          method: method.toUpperCase(),
          type: 'xhr',
          timestamp: Date.now(),
          startTime: performance.now(),
          requestHeaders: {}
        })
      }
      return self.#originalXhrOpen!.call(
        this,
        method,
        url as string,
        async ?? true,
        username,
        password
      )
    }
  }

  #patchXHRSend(self: this): void {
    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const requestData = self.#pendingXHRRequests.get(this)
      if (!requestData) {
        return self.#originalXhrSend!.call(this, body)
      }
      if (body) {
        requestData.requestBody = String(body)
      }
      const startTime = requestData.startTime || performance.now()
      // Claimed at send, not open: Resource Timing clocks the request from
      // the send, and a page may open an XHR long before it sends it.
      const claim = self.#claim(requestData.url!, performance.now())
      const release = () => self.#releaseClaim(claim)
      this.addEventListener('load', function (this: XMLHttpRequest) {
        if (self.#recordXHRResponse(this, requestData, startTime)) {
          self.#settleClaim(claim)
        } else {
          release()
        }
      })
      this.addEventListener('error', release)
      this.addEventListener('abort', release)
      this.addEventListener('timeout', release)
      return self.#originalXhrSend!.call(this, body)
    }
  }

  #patchXHR() {
    if (typeof XMLHttpRequest === 'undefined') {
      return
    }
    this.#originalXhrOpen = XMLHttpRequest.prototype.open
    this.#originalXhrSend = XMLHttpRequest.prototype.send
    this.#patchXHROpen(this)
    this.#patchXHRSend(this)
  }

  #extractHeaders(headers: HeadersInit | Headers): Record<string, string> {
    const result: Record<string, string> = {}

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        result[key.toLowerCase()] = value
      })
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        result[key.toLowerCase()] = value
      })
    } else if (headers) {
      Object.entries(headers).forEach(([key, value]) => {
        result[key.toLowerCase()] = value
      })
    }

    return result
  }

  #extractXHRHeaders(xhr: XMLHttpRequest): Record<string, string> {
    const result: Record<string, string> = {}
    const headersString = xhr.getAllResponseHeaders()

    if (headersString) {
      const headers = headersString.trim().split(/[\r\n]+/)
      headers.forEach((line) => {
        const parts = line.split(': ')
        const key = parts.shift()
        const value = parts.join(': ')
        if (key) {
          result[key.toLowerCase()] = value
        }
      })
    }

    return result
  }

  #estimateSize(body?: string): number {
    if (!body) {
      return 0
    }
    return new Blob([body]).size
  }
}
