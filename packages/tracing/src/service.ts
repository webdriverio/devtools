import fs from 'node:fs/promises'
import path from 'node:path'
import type { Services, Capabilities } from '@wdio/types'
import { TraceRecorder } from './recorder.js'
import type { TraceRecorderOptions } from './recorder.js'
import { registerOverwrites } from './register-overwrites.js'

export type TracingServiceOptions = TraceRecorderOptions

export default class TracingService implements Services.ServiceInstance {
  #recorder?: TraceRecorder
  #options: TracingServiceOptions

  constructor(options: TracingServiceOptions = {}) {
    this.#options = options
  }

  before(
    _caps: Capabilities.W3CCapabilities,
    _specs: string[],
    browser: WebdriverIO.Browser
  ) {
    this.#recorder = new TraceRecorder(browser, this.#options)
    this.#recorder.start()
    registerOverwrites(browser, this.#recorder)
  }

  onReload(_oldSessionId: string, newSessionId: string) {
    this.#recorder?.onReload(newSessionId)
  }

  async after() {
    if (!this.#recorder) {
      return
    }
    const zip = await this.#recorder.stop()
    const outputDir = this.#options.outputDir ?? process.cwd()
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(path.join(outputDir, `trace-${Date.now()}.zip`), zip)
  }
}
