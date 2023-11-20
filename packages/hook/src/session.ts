import fs from 'node:fs/promises'
import url from 'node:url'

import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import { type CommandLog } from './types.js'

export class SessionCapturer {
  #isInjected = false
  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  mutations: TraceMutation[] = []
  traceLogs: string[] = []
  consoleLogs: ConsoleLogs[] = []
  metadata?: {
    url: string;
    viewport: VisualViewport;
  }

  /**
   * after command hook
   *
   * Used to
   *  - capture command logs
   *  - capture trace data from the application under test
   *
   * @param {string} command command name
   * @param {Array} args command arguments
   * @param {object} result command result
   * @param {Error} error command error
   */
  async afterCommand (browser: WebdriverIO.Browser, command: keyof WebDriverCommands, args: any[], result: any, error: Error) {
    const timestamp = Date.now()
    const sourceFile = parse(new Error(''))
      .filter((frame) => Boolean(frame.getFileName()))
      .map((frame) => [frame.getFileName(), frame.getLineNumber(), frame.getColumnNumber()].join(':'))
      .filter((fileName) => (
        !fileName.includes('/node_modules/') &&
        !fileName.includes('<anonymous>)') &&
        !fileName.includes('node:internal') &&
        !fileName.includes('/dist/')
      ))
      .shift() || ''
    const absPath = sourceFile.startsWith('file://')
      ? url.fileURLToPath(sourceFile)
      : sourceFile
    const sourceFilePath = absPath.split(':')[0]
    const fileExist = await fs.access(sourceFilePath).then(() => true, () => false)
    if (sourceFile && !this.sources.has(sourceFile) && fileExist) {
      const sourceCode = await fs.readFile(sourceFilePath, 'utf-8')
      this.sources.set(sourceFilePath, sourceCode.toString())
    }
    this.commandsLog.push({ command, args, result, error, timestamp, callSource: absPath })

    /**
     * capture trace and write to file on commands that could trigger a page transition
     */
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#captureTrace(browser)
    }
  }

  async injectScript (browser: WebdriverIO.Browser) {
    if (this.#isInjected) {
      return
    }

    if (!browser.isBidi) {
      throw new SevereServiceError(`Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`)
    }

    this.#isInjected = true
    const script = await resolve('@wdio/devtools-script', import.meta.url)
    const source = (await fs.readFile(url.fileURLToPath(script))).toString()
    const functionDeclaration = `async () => { ${source} }`

    await browser.scriptAddPreloadScript({
        functionDeclaration
    })
  }

  async #captureTrace (browser: WebdriverIO.Browser) {
    /**
     * only capture trace if script was injected
     */
    if (!this.#isInjected) {
      return
    }

    const { mutations, traceLogs, consoleLogs, metadata } = await browser.execute(() => window.wdioTraceCollector.getTraceData())
    this.metadata = metadata

    if (Array.isArray(mutations)) {
      this.mutations.push(...mutations as TraceMutation[])
    }
    if (Array.isArray(traceLogs)) {
      this.traceLogs.push(...traceLogs)
    }
    if (Array.isArray(consoleLogs)) {
      this.consoleLogs.push(...consoleLogs as ConsoleLogs[])
    }
  }
}
