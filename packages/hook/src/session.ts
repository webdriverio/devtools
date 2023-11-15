import fs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'

import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { getBrowserObject } from './utils.js'
import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import { type CommandLog, type TraceLog, TraceType } from './types.js'

export class SessionCapturer {
  #isInjected = false
  #commandsLog: CommandLog[] = []
  #sources = new Map<string, string>()
  #browser: WebdriverIO.Browser | undefined
  #traceLog: Pick<TraceLog, 'mutations' | 'logs' | 'consoleLogs'> = {
    mutations: [],
    logs: [],
    consoleLogs: []
  }

  /**
   * before command hook
   *
   * Used to
   *   - capture the browser object if not existing
   *   - inject script for capturing application states
   *   - capture trace on `deleteSession` command
   *
   * @param {object} browser browser object
   * @param {string} command command name
   */
  async beforeCommand (browser: WebdriverIO.Browser | WebdriverIO.Element, command: keyof WebDriverCommands) {
    if (!this.#browser) {
      this.#browser = getBrowserObject(browser)
    }
    await this.#injectScript()

    /**
     * capture trace on `deleteSession` since we can't do it in `afterCommand` as the session
     * would be terminated by then
     */
    if (command === 'deleteSession') {
      await this.#browser.pause(1000)
      await this.#captureTrace()
    }
  }

  /**
   * after command hook
   *
   * Used to
   *  - capture command logs
   *  - capture trace data from the application under test
   *
   *
   * @param {string} command command name
   * @param {Array} args command arguments
   * @param {object} result command result
   * @param {Error} error command error
   */
  async afterCommand (command: keyof WebDriverCommands, args: any[], result: any, error: Error) {
    const timestamp = Date.now()
    const callSource = (new Error('')).stack?.split('\n').pop()?.split(' ').pop()!
    const sourceFile = callSource.split(':').slice(0, -2).join(':')
    const absPath = sourceFile.startsWith('file://')
      ? url.fileURLToPath(sourceFile)
      : sourceFile
    const fileExist = await fs.access(absPath).then(() => true, () => false)
    if (sourceFile && !this.#sources.has(sourceFile) && fileExist) {
      const sourceCode = await fs.readFile(absPath, 'utf-8')
      this.#sources.set(absPath, sourceCode.toString())
    }
    this.#commandsLog.push({ command, args, result, error, timestamp, callSource: absPath })

    /**
     * capture trace and write to file on commands that could trigger a page transition
     */
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#captureTrace()
    }
  }

  async #injectScript () {
    if (this.#isInjected || !this.#browser) {
      return
    }

    if (!this.#browser.isBidi) {
      throw new SevereServiceError(`Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`)
    }

    this.#isInjected = true
    const script = await resolve('@wdio/devtools-script', import.meta.url)
    const source = (await fs.readFile(url.fileURLToPath(script))).toString()
    const functionDeclaration = `async () => { ${source} }`

    await this.#browser.scriptAddPreloadScript({
        functionDeclaration
    })
  }

  async #captureTrace () {
    /**
     * only capture trace if script was injected
     */
    if (!this.#isInjected || !this.#browser) {
      return
    }

    const { mutations, traceLogs, metadata, consoleLogs } = await this.#browser.execute(() => window.wdioTraceCollector.getTraceData())

    if (Array.isArray(mutations)) {
      this.#traceLog.mutations.push(...mutations as TraceMutation[])
    }
    if (Array.isArray(traceLogs)) {
      this.#traceLog.logs.push(...traceLogs)
    }
    if (Array.isArray(consoleLogs)) {
      this.#traceLog.consoleLogs.push(...consoleLogs as ConsoleLogs[])
    }

    const outputDir = this.#browser.options.outputDir || process.cwd()
    const { capabilities, ...options } = this.#browser.options as Options.WebdriverIO
    const traceLog: TraceLog = {
      mutations: this.#traceLog.mutations,
      logs: this.#traceLog.logs,
      consoleLogs: this.#traceLog.consoleLogs,
      metadata: {
        type: TraceType.Standalone,
        ...metadata,
        options,
        capabilities
      },
      commands: this.#commandsLog,
      sources: Object.fromEntries(this.#sources)
    }

    /**
     * ToDo(Christian): we are writing the trace to file after every command, we should find smarter ways
     * to do this less often
     */
    await fs.writeFile(path.join(outputDir, `wdio-trace-${this.#browser.sessionId}.json`), JSON.stringify(traceLog))
  }
}
