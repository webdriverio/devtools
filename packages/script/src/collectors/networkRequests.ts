import type { Collector } from './collector.js'

export interface NetworkRequest {
  id: string
  url: string
  method: string
  status?: number
  statusText?: string
  type: string
  initiator?: string
  size?: number
  time?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  timestamp: number
  startTime: number
  endTime?: number
  error?: string
}

export class NetworkRequestCollector implements Collector<NetworkRequest> {
  #requests: NetworkRequest[] = []
  #pendingRequests = new Map<string, Partial<NetworkRequest>>()
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
    if (!url) return true

    const urlLower = url.toLowerCase()

    // Ignore non-HTTP protocols
    if (urlLower.startsWith('data:')) return true
    if (urlLower.startsWith('blob:')) return true
    if (urlLower.startsWith('chrome:')) return true
    if (urlLower.startsWith('chrome-extension:')) return true
    if (urlLower.startsWith('about:')) return true

    // Ignore WebSocket connections
    if (urlLower.startsWith('ws:') || urlLower.startsWith('wss:')) return true

    // Ignore browser internal requests
    if (urlLower.includes('/.well-known/')) return true
    if (urlLower.includes('/favicon.ico')) return true

    return false
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
      const id = self.#generateId()
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method?.toUpperCase() || 'GET'

      // Skip internal/non-HTTP requests
      if (self.#shouldIgnoreRequest(url)) {
        return self.#originalFetch!.apply(this, [input, init])
      }

      const startTime = performance.now()
      const timestamp = Date.now()

      const request: Partial<NetworkRequest> = {
        id,
        url,
        method,
        type: 'fetch',
        timestamp,
        startTime,
        requestHeaders: init?.headers ? self.#extractHeaders(init.headers) : {},
        requestBody: init?.body ? String(init.body) : undefined
      }

      self.#pendingRequests.set(id, request)

      try {
        const response = await self.#originalFetch!.apply(this, [input, init])
        const endTime = performance.now()
        const time = endTime - startTime

        const responseHeaders = self.#extractHeaders(response.headers)
        const contentType = responseHeaders['content-type']?.trim()

        if (!contentType || contentType === '-') {
          self.#pendingRequests.delete(id)
          return response
        }

        let responseBody: string | undefined
        try {
          if (contentType.includes('application/json') || contentType.includes('text/')) {
            responseBody = await response.clone().text()
          }
        } catch (e) {
          // Ignore body read errors
        }

        const networkRequest: NetworkRequest = {
          id,
          url,
          method,
          status: response.status,
          statusText: response.statusText,
          type: 'fetch',
          timestamp,
          startTime,
          endTime,
          time,
          requestHeaders: request.requestHeaders,
          responseHeaders,
          requestBody: request.requestBody,
          responseBody,
          size: self.#estimateSize(responseBody)
        }

        self.#requests.push(networkRequest)
        self.#pendingRequests.delete(id)

        return response
      } catch (error) {
        self.#pendingRequests.delete(id)
        throw error
      }
    }
  }

  #patchXHR() {
    if (typeof XMLHttpRequest === 'undefined') {
      return
    }

    const self = this
    this.#originalXhrOpen = XMLHttpRequest.prototype.open
    this.#originalXhrSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      const id = self.#generateId()
      const urlString = typeof url === 'string' ? url : url.href

      // Skip internal/non-HTTP requests
      if (self.#shouldIgnoreRequest(urlString)) {
        return self.#originalXhrOpen!.call(
          this,
          method,
          url as string,
          async ?? true,
          username,
          password
        )
      }

      ;(this as any)._networkRequestId = id
      ;(this as any)._networkRequestData = {
        id,
        url: urlString,
        method: method.toUpperCase(),
        type: 'xhr',
        timestamp: Date.now(),
        startTime: performance.now(),
        requestHeaders: {}
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

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const requestData = (this as any)._networkRequestData as Partial<NetworkRequest>

      // If no request data, this request was filtered out - just send it
      if (!requestData) {
        return self.#originalXhrSend!.call(this, body)
      }

      if (body) {
        requestData.requestBody = String(body)
      }

      const startTime = requestData.startTime || performance.now()

      const loadHandler = function (this: XMLHttpRequest) {
        const endTime = performance.now()
        const time = endTime - startTime

        const responseHeaders = self.#extractXHRHeaders(this)
        const contentType = responseHeaders['content-type']?.trim()

        if (!contentType || contentType === '-') {
          return
        }

        let responseBody: string | undefined
        try {
          if (contentType.includes('application/json') || contentType.includes('text/')) {
            responseBody = this.responseText
          }
        } catch (e) {
          // Ignore
        }

        const networkRequest: NetworkRequest = {
          id: requestData.id!,
          url: requestData.url!,
          method: requestData.method!,
          status: this.status,
          statusText: this.statusText,
          type: 'xhr',
          timestamp: requestData.timestamp!,
          startTime,
          endTime,
          time,
          requestHeaders: requestData.requestHeaders,
          responseHeaders,
          requestBody: requestData.requestBody,
          responseBody,
          size: self.#estimateSize(responseBody)
        }

        self.#requests.push(networkRequest)
      }

      const errorHandler = function (this: XMLHttpRequest) {
        // Skip errors
      }

      this.addEventListener('load', loadHandler)
      this.addEventListener('error', errorHandler)

      return self.#originalXhrSend!.call(this, body)
    }
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
    if (!body) return 0
    return new Blob([body]).size
  }
}
