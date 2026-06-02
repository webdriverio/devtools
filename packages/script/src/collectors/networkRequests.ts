import type { Collector } from './collector.js'
import type { NetworkRequest } from '../../types.js'

export class NetworkRequestCollector implements Collector<NetworkRequest> {
  #requests: NetworkRequest[] = []
  #pendingRequests = new Map<string, Partial<NetworkRequest>>()
  #pendingXHRRequests = new WeakMap<XMLHttpRequest, Partial<NetworkRequest>>()
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

  #generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  #shouldIgnoreRequest(url: string): boolean {
    // Filter out internal URLs, data URLs, blob URLs, chrome extensions, etc.
    if (!url) {
      return true
    }

    const urlLower = url.toLowerCase()

    // Ignore non-HTTP protocols
    if (urlLower.startsWith('data:')) {
      return true
    }
    if (urlLower.startsWith('blob:')) {
      return true
    }
    if (urlLower.startsWith('chrome:')) {
      return true
    }
    if (urlLower.startsWith('chrome-extension:')) {
      return true
    }
    if (urlLower.startsWith('about:')) {
      return true
    }

    // Ignore WebSocket connections
    if (urlLower.startsWith('ws:') || urlLower.startsWith('wss:')) {
      return true
    }

    // Ignore browser internal requests
    if (urlLower.includes('/.well-known/')) {
      return true
    }
    if (urlLower.includes('/favicon.ico')) {
      return true
    }

    return false
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

  async #recordFetchResponse(
    id: string,
    request: Partial<NetworkRequest>,
    response: Response,
    startTime: number
  ): Promise<void> {
    const endTime = performance.now()
    const responseHeaders = this.#extractHeaders(response.headers)
    const contentType = responseHeaders['content-type']?.trim()
    if (!contentType || contentType === '-') {
      this.#pendingRequests.delete(id)
      return
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
      if (self.#shouldIgnoreRequest(url)) {
        return self.#originalFetch!.apply(this, [input, init])
      }
      const id = self.#generateId()
      const startTime = performance.now()
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
        await self.#recordFetchResponse(id, request, response, startTime)
        return response
      } catch (error) {
        self.#pendingRequests.delete(id)
        throw error
      }
    }
  }

  #recordXHRResponse(
    xhr: XMLHttpRequest,
    requestData: Partial<NetworkRequest>,
    startTime: number
  ): void {
    const endTime = performance.now()
    const responseHeaders = this.#extractXHRHeaders(xhr)
    const contentType = responseHeaders['content-type']?.trim()
    if (!contentType || contentType === '-') {
      return
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
      if (!self.#shouldIgnoreRequest(urlString)) {
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
      this.addEventListener('load', function (this: XMLHttpRequest) {
        self.#recordXHRResponse(this, requestData, startTime)
      })
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
