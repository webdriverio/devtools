import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import type { AddressInfo } from 'node:net'

import type { TraceMutation } from '@wdio/devtools-shared'

import {
  BIDI_PATH,
  BLANK_PNG,
  BROKEN_PATH,
  COLLECTOR_SIGNATURE,
  ELEMENT_KEY,
  NAVIGATION_HALF_MS,
  PAGES
} from './constants.js'
import { attachFakeBidi } from './fake-bidi.js'
import type {
  ActionMethod,
  BrowserDocument,
  FailedNavigation,
  GroundTruth
} from './types.js'

interface Document extends BrowserDocument {
  path: string
  collector: boolean
  anchored: boolean
  buffer: TraceMutation[]
}

interface Element {
  selector: string
  document: Document
}

type Reply = { status?: number; value: unknown }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const anchorOf = (url: string, bornAt: number): TraceMutation => ({
  type: 'childList',
  url,
  timestamp: bornAt,
  addedNodes: [],
  removedNodes: []
})

/** A W3C WebDriver over a two-page model; without a preload its collector anchors only when a drain forces it. */
export class FakeWebDriver {
  readonly origin: string
  #server: Server
  #bidi: boolean
  #closeBidi: () => void = () => {}
  #preloaded = false
  #documents: Document[] = []
  #failedNavigations: FailedNavigation[] = []
  #actions: Record<ActionMethod, number> = { navigate: 0, click: 0, fill: 0 }
  #elements = new Map<string, Element>()

  private constructor(server: Server, bidi: boolean) {
    this.#server = server
    this.#bidi = bidi
    this.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  /** With `bidi`, a registered preload puts the collector in every later document from birth. */
  static async start({ bidi = false } = {}): Promise<FakeWebDriver> {
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const driver = new FakeWebDriver(server, bidi)
    server.on('request', (req, res) => void driver.#handle(req, res))
    if (bidi) {
      driver.#closeBidi = attachFakeBidi(
        server,
        () => (driver.#preloaded = true)
      )
    }
    return driver
  }

  url(path: string): string {
    return `${this.origin}${path}`
  }

  truth(): GroundTruth {
    return {
      documents: this.#documents.map(({ url, bornAt }) => ({ url, bornAt })),
      failedNavigations: [...this.#failedNavigations],
      actions: { ...this.#actions }
    }
  }

  close(): Promise<void> {
    this.#endBidi()
    return new Promise((r) => this.#server.close(() => r()))
  }

  #endBidi(): void {
    this.#closeBidi()
    this.#closeBidi = () => {}
  }

  get #current(): Document | undefined {
    return this.#documents.at(-1)
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = ''
    for await (const chunk of req) {
      body += chunk
    }
    const params = body ? (JSON.parse(body) as Record<string, unknown>) : {}
    const path = (req.url ?? '').replace(/^\/session\/[^/]+/, '')
    const reply = await this.#route(req.method ?? 'GET', path, params)
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ value: reply.value }))
  }

  // An endpoint not listed answers null, which every caller reads as "nothing to report".
  async #route(
    method: string,
    path: string,
    params: Record<string, unknown>
  ): Promise<Reply> {
    if (method === 'POST' && path === '/session') {
      const wantsBidi = JSON.stringify(params).includes('"webSocketUrl":true')
      const capabilities: Record<string, unknown> = { browserName: 'chrome' }
      if (this.#bidi && wantsBidi) {
        capabilities.webSocketUrl = `${this.origin.replace('http', 'ws')}${BIDI_PATH}`
      }
      return { value: { sessionId: 'conformance', capabilities } }
    }
    if (method === 'DELETE' && path === '') {
      // A browser drops its BiDi socket with the session; one left open holds the adapter's process.
      this.#endBidi()
      return { value: null }
    }
    if (method === 'POST' && path === '/url') {
      this.#actions.navigate++
      return this.#navigate(new URL(String(params.url)).pathname)
    }
    if (method === 'GET' && path === '/url') {
      return { value: this.#current?.url ?? 'about:blank' }
    }
    if (method === 'GET' && path === '/title') {
      return { value: this.#current?.path ?? '' }
    }
    if (method === 'POST' && (path === '/element' || path === '/elements')) {
      return this.#find(String(params.value), path === '/elements')
    }
    const element = path.match(/^\/element\/([^/]+)\/(value|click|clear|text)$/)
    if (element) {
      return this.#onElement(element[1], element[2], params)
    }
    if (method === 'POST' && path.startsWith('/execute/')) {
      return {
        value: this.#execute(
          String(params.script),
          JSON.stringify(params.args ?? [])
        )
      }
    }
    if (path === '/screenshot') {
      return { value: BLANK_PNG }
    }
    if (path === '/window/rect') {
      return { value: { x: 0, y: 0, width: 1280, height: 720 } }
    }
    return { value: null }
  }

  async #navigate(path: string): Promise<Reply> {
    await sleep(NAVIGATION_HALF_MS)
    if (path === BROKEN_PATH) {
      const message = `net::ERR_FAILED at ${path}`
      this.#failedNavigations.push({ url: this.url(path), message })
      return {
        status: 500,
        // A driver's native frames ride along beside the message, as chromedriver sends them.
        value: {
          error: 'unknown error',
          message,
          stacktrace: '#0 0x55d0 <unknown>'
        }
      }
    }
    const url = this.url(path)
    const bornAt = Date.now()
    // A preloaded collector anchors its document at birth, as `packages/script` does in Chrome.
    const preloaded = this.#preloaded
    this.#documents.push({
      path,
      url,
      bornAt,
      collector: preloaded,
      anchored: preloaded,
      buffer: preloaded ? [anchorOf(url, bornAt)] : []
    })
    await sleep(NAVIGATION_HALF_MS)
    return { value: null }
  }

  #find(selector: string, many: boolean): Reply {
    const doc = this.#current
    if (!doc || !(selector in (PAGES[doc.path] ?? {}))) {
      return many
        ? { value: [] }
        : {
            status: 404,
            value: {
              error: 'no such element',
              message: `no element ${selector}`,
              stacktrace: ''
            }
          }
    }
    const id = `el-${this.#elements.size + 1}`
    this.#elements.set(id, { selector, document: doc })
    const ref = { [ELEMENT_KEY]: id }
    return { value: many ? [ref] : ref }
  }

  async #onElement(
    id: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<Reply> {
    const el = this.#elements.get(id)
    if (!el || el.document !== this.#current) {
      return {
        status: 404,
        value: { error: 'stale element reference', message: id, stacktrace: '' }
      }
    }
    if (action === 'value') {
      this.#actions.fill++
    } else if (action === 'click') {
      this.#actions.click++
    }
    if (action === 'value' && el.document.collector) {
      el.document.buffer.push({
        type: 'attributes',
        target: el.selector,
        attributeName: 'value',
        attributeValue: String(params.text ?? ''),
        addedNodes: [],
        removedNodes: [],
        timestamp: Date.now()
      })
    }
    const destination =
      action === 'click' ? PAGES[el.document.path][el.selector] : null
    if (destination) {
      return this.#navigate(destination)
    }
    return { value: action === 'text' ? el.selector : null }
  }

  // Recognised by the collector's own API, not by how any one adapter phrases its scripts.
  #execute(script: string, args: string): unknown {
    const doc = this.#current
    if (!doc) {
      return null
    }
    if (COLLECTOR_SIGNATURE.test(script) || COLLECTOR_SIGNATURE.test(args)) {
      doc.collector = true
      return true
    }
    if (script.includes('getTraceData')) {
      return this.#drain(doc, script.includes('captureCurrentDom'))
    }
    if (script.includes('wdioTraceCollector')) {
      return doc.collector
    }
    return null
  }

  #drain(doc: Document, forceAnchor: boolean): unknown {
    if (!doc.collector) {
      return null
    }
    if (forceAnchor && !doc.anchored) {
      doc.anchored = true
      doc.buffer.unshift(anchorOf(doc.url, doc.bornAt))
    }
    const mutations = doc.buffer.splice(0)
    return {
      errors: [],
      mutations,
      consoleLogs: [],
      networkRequests: [],
      traceLogs: [],
      metadata: {}
    }
  }
}
