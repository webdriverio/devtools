import { createTraceSession, getMonotonicMs } from './state.js'
import { buildTraceZip } from './zip-writer.js'
import { mapCommandToAction, formatActionTitle, ELEMENT_COMMANDS } from './action-mapping.js'
import { getElements, type VisibleElementsResult } from '@wdio/elements'
import { NetworkTracer } from './network.js'
import type { TraceSession } from './types.js'

export interface TraceRecorderOptions {
  outputDir?: string
  screenshotQuality?: number
}

export class TraceRecorder {
  #session!: TraceSession
  #networkTracer!: NetworkTracer
  #internalCommandDepth = 0
  #browser: WebdriverIO.Browser
  #bidiListenersSetup = false
  #options: TraceRecorderOptions

  constructor(browser: WebdriverIO.Browser, options?: TraceRecorderOptions) {
    this.#browser = browser
    this.#options = options ?? {}
  }

  start(): void {
    const caps = this.#browser.capabilities as Record<string, unknown>
    const isAndroid = (this.#browser as any).isAndroid as boolean | undefined
    const isIOS = (this.#browser as any).isIOS as boolean | undefined

    let browserName: string
    let viewport: { width: number; height: number }
    let title: string
    let sessionType: 'browser' | 'ios' | 'android' = 'browser'

    if (isAndroid) {
      sessionType = 'android'
      browserName = 'chromium'
      const deviceName = String(caps['appium:deviceName'] ?? 'device')
      title = `android - ${deviceName}`
      viewport = { width: 412, height: 915 }
    } else if (isIOS) {
      sessionType = 'ios'
      browserName = 'chromium'
      const deviceName = String(caps['appium:deviceName'] ?? 'device')
      title = `ios - ${deviceName}`
      viewport = { width: 390, height: 844 }
    } else {
      browserName = String(caps.browserName ?? 'chromium')
      viewport = { width: 1920, height: 1080 }
      title = String(caps.browserName ?? browserName)
    }

    this.#session = createTraceSession(
      this.#browser.sessionId,
      browserName,
      viewport,
      title,
      sessionType
    )
    this.#networkTracer = new NetworkTracer(() => getMonotonicMs(this.#session))
  }

  async wrapAction(
    command: string,
    args: unknown[],
    selector: string | undefined,
    invoke: () => Promise<unknown>
  ): Promise<unknown> {
    if (this.#internalCommandDepth > 0) {
      return invoke()
    }

    const action = mapCommandToAction(command)
    if (!action) {
      return invoke()
    }

    this.#setupBidiListeners()
    await this.#captureScreenshot()

    const callId = `call@${++this.#session.callCounter}`
    const startTime = getMonotonicMs(this.#session)

    const params: Record<string, unknown> = Object.fromEntries(
      args.map((a, i) => [String(i), a])
    )
    if (selector) {
      params.selector = selector
    }

    this.#session.events.push({
      type: 'before',
      callId,
      startTime,
      class: action.class,
      method: action.method,
      pageId: this.#session.pageId,
      params,
      title: formatActionTitle(action, command, args, params),
    })

    if (ELEMENT_COMMANDS.has(command)) {
      // no-op — input events removed (web-only, Appium incompatible)
    }

    let error: Error | undefined
    try {
      return await invoke()
    } catch (e) {
      error = e as Error
      throw e
    } finally {
      const endTime = getMonotonicMs(this.#session)
      this.#session.events.push({
        type: 'after',
        callId,
        endTime,
        ...(error ? { error: { message: error.message } } : {})
      })
      this.#session.lastAfterEndTime = endTime
    }
  }

  onReload(newSessionId: string): void {
    const prefix = newSessionId.slice(0, 8)
    this.#session.sessionId = newSessionId
    this.#session.pageId = `page@${prefix}`
    this.#session.contextId = `context@${prefix}`
  }

  async stop(): Promise<Buffer> {
    await this.#captureScreenshot()
    await this.#session.screenshotChain
    return buildTraceZip(this.#session, this.#networkTracer.entries)
  }

  get session(): TraceSession {
    return this.#session
  }

  #setupBidiListeners(): void {
    if (this.#bidiListenersSetup || !(this.#browser as any).isBidi) {
      return
    }
    this.#bidiListenersSetup = true
    this.#browser.on('network.beforeRequestSent', (e: any) =>
      this.#networkTracer.handleRequestStarted(e)
    )
    this.#browser.on('network.responseCompleted', (e: any) =>
      this.#networkTracer.handleResponseCompleted(e)
    )
    this.#browser.on('network.fetchError', (e: any) =>
      this.#networkTracer.handleFetchError(e)
    )
  }

  async #runInternal<T>(fn: () => Promise<T>): Promise<T> {
    this.#internalCommandDepth++
    try {
      return await fn()
    } finally {
      this.#internalCommandDepth--
    }
  }

  async #captureElements(wallTimestamp: number): Promise<string | undefined> {
    try {
      const result = await this.#runInternal(() =>
        getElements(this.#browser, { inViewportOnly: true, includeBounds: true })
      ) as VisibleElementsResult
      const resourceName = `elements-${this.#session.pageId}-${wallTimestamp}.json`
      const data = Buffer.from(JSON.stringify(result.elements), 'utf8')
      this.#session.elementSnapshots.push({ resourceName, data })
      return resourceName
    } catch {
      return undefined
    }
  }

  async #captureScreenshot(): Promise<void> {
    if (this.#internalCommandDepth > 0) {
      return
    }
    try {
      const base64 = await this.#runInternal(() =>
        this.#browser.takeScreenshot()
      )
      const inputBuffer = Buffer.from(base64, 'base64')

      let imageBuffer: Buffer
      let width: number
      let height: number
      let ext: string
      try {
        const sharp = (await import('sharp')).default
        const image = sharp(inputBuffer)
        const metadata = await image.metadata()
        width = metadata.width ?? 1280
        height = metadata.height ?? 720
        imageBuffer = await image
          .jpeg({ quality: this.#options.screenshotQuality ?? 60 })
          .toBuffer()
        ext = 'jpeg'
      } catch {
        imageBuffer = inputBuffer
        width = 1280
        height = 720
        ext = 'png'
      }

      const wallTimestamp =
        this.#session.startWallTime + getMonotonicMs(this.#session)
      const screenshotName = `${this.#session.pageId}-${wallTimestamp}.${ext}`
      this.#session.screenshots.push({
        resourceName: screenshotName,
        data: imageBuffer,
        width,
        height
      })

      const elementsName = await this.#captureElements(wallTimestamp)

      this.#session.events.push({
        type: 'screencast-frame',
        pageId: this.#session.pageId,
        sha1: screenshotName,
        ...(elementsName ? { elements: elementsName } : {}),
        width,
        height,
        timestamp: this.#session.lastAfterEndTime
      })
    } catch {
      // screenshot failures must not mask action result
    }
  }
}
