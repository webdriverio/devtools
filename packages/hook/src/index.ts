/// <reference types="../node_modules/@devtools/script/types.d.ts" />

import fs from 'node:fs/promises'
import url from 'node:url'
import path from 'node:path'

import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'

interface CommandLog {
  command: keyof WebDriverCommands
  args: any[]
  result: any
  error?: Error
}

interface TraceLog {
  mutations: any[]
  logs: string[]
  metadata: {
    id: string,
    url: string
    options: Omit<Options.WebdriverIO, 'capabilities'>
    capabilities: Capabilities.RemoteCapability
  }
  commands: CommandLog[]
}

let commandsLog: CommandLog[] = []
let currentTraceId: string | undefined

export function setupForDevtools (opts: Options.WebdriverIO) {
  /**
   * make sure to run with Bidi enabled
   */
  const w3cCaps = opts.capabilities as Capabilities.W3CCapabilities
  const multiRemoteCaps = opts.capabilities as Capabilities.MultiRemoteCapabilities
  const caps = w3cCaps.alwaysMatch
    ? w3cCaps.alwaysMatch
    : multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities
      ? multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities as WebdriverIO.Capabilities
      : opts.capabilities as WebdriverIO.Capabilities
  caps.webSocketUrl = true

  opts.beforeCommand = Array.isArray(opts.beforeCommand)
    ? opts.beforeCommand
    : opts.beforeCommand ? [opts.beforeCommand] : []
  opts.beforeCommand.push(async function (this: WebdriverIO.Browser, command) {
    await injectScript(this)

    /**
     * capture trace on `deleteSession` before command is called
     */
    if (command === 'deleteSession') {
      await this.pause(1000)
      await captureTrace(this, command as keyof WebDriverCommands, [])
    }
  })

  opts.afterCommand = Array.isArray(opts.afterCommand)
    ? opts.afterCommand
    : opts.afterCommand ? [opts.afterCommand] : []
  opts.afterCommand.push(async function(this: WebdriverIO.Browser, command: keyof WebDriverCommands, args, result, error) {
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await captureTrace(this, command as keyof WebDriverCommands, args, result, error)
    }
  })

  return opts
}

let isInjected = false
async function injectScript (browser: WebdriverIO.Browser) {
  if (isInjected) {
    return
  }

  if (!browser.isBidi) {
    throw new SevereServiceError(`Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`)
  }

  isInjected = true
  const script = await resolve('@devtools/script', import.meta.url)
  const source = (await fs.readFile(url.fileURLToPath(script))).toString()
  const functionDeclaration = `async () => { ${source} }`

  await browser.scriptAddPreloadScriptCommand({
      functionDeclaration
  })
}

async function captureTrace (browser: WebdriverIO.Browser, command: (keyof WebDriverCommands), args: any, result?: any, error?: Error) {
  /**
   * only capture trace if script was injected and command is a page transition command
   */
  if (!isInjected) {
    return
  }

  const [, mutations, logs, pageMetadata] = await browser.execute(() => [
    window.wdioCaptureErrors,
    window.wdioDOMChanges,
    window.wdioTraceLogs,
    window.wdioMetadata
  ])

  if (currentTraceId !== pageMetadata.id) {
    commandsLog = []
  }

  commandsLog.push({ command, args, result, error })
  const outputDir = browser.options.outputDir || process.cwd()
  const { capabilities, ...options } = browser.options as Options.WebdriverIO
  const traceLog: TraceLog = {
    mutations,
    logs,
    metadata: {
      ...pageMetadata,
      options,
      capabilities
    },
    commands: commandsLog
  }
  await fs.writeFile(path.join(outputDir, `${pageMetadata.id}.json`), JSON.stringify(traceLog))
}
