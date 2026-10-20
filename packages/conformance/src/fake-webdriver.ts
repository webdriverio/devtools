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
  BIDI_RESULTS,
  BLANK_PNG,
  BROKEN_PATH,
  COLLECTOR_SIGNATURE,
  DEFAULT_TIMEOUTS,
  ELEMENT_KEY,
  NAVIGATION_HALF_MS,
  PAGES,
  WINDOW_HANDLE
} from './constants.js'
import { attachFakeBidi, remoteValue } from './fake-bidi.js'
import type {
  ActionMethod,
  BidiAnswer,
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

/** `action` marks a user action, stamped as completed when its response is sent. */
type Reply = {
  status?: number
  value: unknown
  action?: ActionMethod
  /** Set on a refused navigation, so an immediate repeat can be read as the client's own retry. */
  failedNavigation?: string
  retried?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const FIXED_REPLIES: Record<string, unknown> = {
  '/timeouts': DEFAULT_TIMEOUTS,
  '/screenshot': BLANK_PNG,
  '/window/rect': { x: 0, y: 0, width: 1280, height: 720 },
  '/window': WINDOW_HANDLE,
  '/window/handles': [WINDOW_HANDLE]
}

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
  #preloads = 0
  #documents: Document[] = []
  #failedNavigations: FailedNavigation[] = []
  #actions: Record<ActionMethod, number[]> = {
    navigate: [],
    click: [],
    fill: []
  }
  #elements = new Map<string, Element>()
  #lastFailedNavigation: string | undefined

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
      driver.#closeBidi = attachFakeBidi(server, (method, params) =>
        driver.#bidiCommand(method, params)
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
      actions: {
        navigate: [...this.#actions.navigate],
        click: [...this.#actions.click],
        fill: [...this.#actions.fill]
      }
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
    const reply = this.#complete(
      await this.#route(req.method ?? 'GET', path, params)
    )
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ value: reply.value }))
  }

  /** Stamps a user action as completed when its reply goes out, over either protocol. */
  #complete(reply: Reply): Reply {
    if (reply.action) {
      const completions = this.#actions[reply.action]
      // The user's one action completes with the client's last attempt.
      if (reply.retried) {
        completions[completions.length - 1] = Date.now()
      } else {
        completions.push(Date.now())
      }
    }
    // A retry run ends with the next user action; the reads and scripts an adapter issues in between are not one.
    if (reply.failedNavigation !== undefined || reply.action) {
      this.#lastFailedNavigation = reply.failedNavigation
    }
    return reply
  }

  #session(
    method: string,
    path: string,
    params: Record<string, unknown>
  ): Reply | undefined {
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
    return undefined
  }

  // An endpoint not listed answers null, which every caller reads as "nothing to report".
  async #route(
    method: string,
    path: string,
    params: Record<string, unknown>
  ): Promise<Reply> {
    const session = this.#session(method, path, params)
    if (session) {
      return session
    }
    if (method === 'POST' && path === '/url') {
      return {
        ...(await this.#navigate(new URL(String(params.url)).pathname)),
        action: 'navigate'
      }
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
    return { value: FIXED_REPLIES[path] ?? null }
  }

  async #navigate(path: string): Promise<Reply> {
    await sleep(NAVIGATION_HALF_MS)
    if (path === BROKEN_PATH) {
      const url = this.url(path)
      const message = `net::ERR_FAILED at ${path}`
      // A client re-issues a refused navigation on its own (Nightwatch's transport retries a failed
      // protocol action, measured 3 attempts 1 s apart); the user issued one, so a repeat counts once.
      const retried = this.#lastFailedNavigation === url
      if (!retried) {
        this.#failedNavigations.push({ url, message })
      }
      return {
        status: 500,
        // A driver's native frames ride along beside the message, as chromedriver sends them.
        value: {
          error: 'unknown error',
          message,
          stacktrace: '#0 0x55d0 <unknown>'
        },
        failedNavigation: url,
        retried
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
    const kind: ActionMethod | undefined =
      action === 'value' ? 'fill' : action === 'click' ? 'click' : undefined
    const destination =
      action === 'click' ? PAGES[el.document.path][el.selector] : null
    if (destination) {
      return { ...(await this.#navigate(destination)), action: kind }
    }
    return { value: action === 'text' ? el.selector : null, action: kind }
  }

  // Recognised by the collector's own API, not by how any one adapter phrases its scripts.
  #execute(script: string, args: string): unknown {
    const doc = this.#current
    if (!doc) {
      return null
    }
    if (COLLECTOR_SIGNATURE.test(script) || COLLECTOR_SIGNATURE.test(args)) {
      // A fresh collector starts unanchored, as the real one does, so injecting twice can anchor twice.
      doc.collector = true
      doc.anchored = false
      return true
    }
    if (script.includes('getTraceData')) {
      return this.#drain(doc, script.includes('captureCurrentDom'))
    }
    if (script.includes('wdioTraceCollector')) {
      return doc.collector
    }
    if (script.includes('document.URL')) {
      return doc.url
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

  // What WebdriverIO routes over BiDi once a session offers it; anything else is acknowledged.
  async #bidiCommand(
    method: string,
    params: Record<string, unknown>
  ): Promise<BidiAnswer> {
    if (method === 'script.addPreloadScript') {
      // Only the collector's own source counts; an unrelated preload instruments nothing.
      if (COLLECTOR_SIGNATURE.test(String(params.functionDeclaration ?? ''))) {
        this.#preloaded = true
      }
      return { result: { script: `preload-${++this.#preloads}` } }
    }
    if (method === 'browsingContext.getTree') {
      const context = {
        context: WINDOW_HANDLE,
        url: this.#current?.url ?? 'about:blank',
        children: [],
        parent: null,
        userContext: 'default'
      }
      return { result: { contexts: [context] } }
    }
    if (method === 'browsingContext.navigate') {
      return this.#bidiNavigate(String(params.url))
    }
    if (method === 'browsingContext.locateNodes') {
      return this.#bidiLocateNodes(
        params.locator as { type: string; value: string }
      )
    }
    if (method === 'script.callFunction' || method === 'script.evaluate') {
      const value = this.#execute(
        String(params.functionDeclaration ?? params.expression ?? ''),
        JSON.stringify(params.arguments ?? [])
      )
      return {
        result: {
          type: 'success',
          result: remoteValue(value),
          realm: 'realm-1'
        }
      }
    }
    if (method === 'browsingContext.captureScreenshot') {
      return { result: { data: BLANK_PNG } }
    }
    return { result: BIDI_RESULTS[method] ?? {} }
  }

  async #bidiNavigate(url: string): Promise<BidiAnswer> {
    const reply = this.#complete({
      ...(await this.#navigate(new URL(url).pathname)),
      action: 'navigate'
    })
    if (reply.status) {
      return reply.value as { error: string; message: string }
    }
    // No result at all: given one, WebdriverIO waits for the network events of its navigation id, which this browser never emits.
    return { result: null }
  }

  #bidiLocateNodes(locator: { type: string; value: string }): BidiAnswer {
    if (locator.type !== 'css') {
      return {
        error: 'unsupported operation',
        message: `no ${locator.type} locator`
      }
    }
    const refs = this.#find(locator.value, true).value as Record<
      string,
      string
    >[]
    const nodes = refs.map((ref) => ({
      type: 'node',
      sharedId: ref[ELEMENT_KEY],
      value: { nodeType: 1, childNodeCount: 0 }
    }))
    return { result: { nodes } }
  }
}
