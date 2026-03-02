/**
 * Browser Proxy
 * Handles browser command interception and tracking
 */

import logger from '@wdio/logger'
import { INTERNAL_COMMANDS_TO_IGNORE } from '../constants.js'
import { getCallSourceFromStack } from './utils.js'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type { NightwatchBrowser } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:browserProxy')

interface CommandStackFrame {
  command: string
  callSource?: string
  signature: string
}

export class BrowserProxy {
  private browserProxied = false
  private commandStack: CommandStackFrame[] = []
  private lastCommandSig: string | null = null
  private currentTestFullPath: string | null = null

  constructor(
    private sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => any
  ) {}

  /**
   * Reset command tracking for new test
   */
  resetCommandTracking(): void {
    this.commandStack = []
    this.lastCommandSig = null
  }

  /**
   * Get current test file path
   */
  getCurrentTestFullPath(): string | null {
    return this.currentTestFullPath
  }

  /**
   * Set current test file path
   */
  setCurrentTestFullPath(path: string | null): void {
    this.currentTestFullPath = path
  }

  /**
   * Wrap browser.url to inject script after navigation
   */
  wrapUrlMethod(browser: NightwatchBrowser): void {
    const originalUrl = browser.url.bind(browser)
    const sessionCapturer = this.sessionCapturer

    browser.url = function (url: string) {
      const result = originalUrl(url) as any

      if (result && typeof result.perform === 'function') {
        result.perform(async function (this: any) {
          try {
            log.info(`Injecting script after navigation to: ${url}`)
            await sessionCapturer.injectScript(this)
          } catch (err) {
            log.error(`Failed to inject script: ${(err as Error).message}`)
          }
        })
      }

      return result
    } as any

    log.info('✓ Script injection wrapped')
  }

  /**
   * Wrap all browser commands to capture them
   */
  wrapBrowserCommands(browser: NightwatchBrowser): void {
    if (this.browserProxied) {
      return
    }

    const browserAny = browser as any
    const allMethods = new Set([
      ...Object.keys(browser),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(browser))
    ])
    const wrappedMethods: string[] = []

    allMethods.forEach((methodName) => {
      if (
        methodName === 'constructor' ||
        typeof browserAny[methodName] !== 'function'
      ) {
        return
      }

      if (
        INTERNAL_COMMANDS_TO_IGNORE.includes(methodName as any) ||
        methodName.startsWith('__')
      ) {
        return
      }

      const originalMethod = browserAny[methodName].bind(browser)

      browserAny[methodName] = (...args: any[]) => {
        return this.handleCommandExecution(
          browser,
          browserAny,
          methodName,
          originalMethod,
          args
        )
      }

      wrappedMethods.push(methodName)
    })

    this.browserProxied = true
    log.info(`✓ Wrapped ${wrappedMethods.length} browser methods`)
  }

  /**
   * Handle command execution with tracking
   */
  private handleCommandExecution(
    browser: NightwatchBrowser,
    browserAny: any,
    methodName: string,
    originalMethod: Function,
    args: any[]
  ): any {
    // Detect test boundaries
    const currentNightwatchTest = browserAny.currentTest
    const currentTestName = this.testManager.detectTestBoundary(
      currentNightwatchTest
    )

    // Start test if this is its first command
    this.testManager.startTestIfPending(currentTestName)

    // Get call source
    const callInfo = getCallSourceFromStack()
    if (callInfo.filePath && !this.currentTestFullPath) {
      this.currentTestFullPath = callInfo.filePath
    }

    // Check for duplicate commands
    const cmdSig = JSON.stringify({
      command: methodName,
      args,
      src: callInfo.callSource
    })
    const isDuplicate = this.lastCommandSig === cmdSig

    if (!isDuplicate) {
      this.commandStack.push({
        command: methodName,
        callSource: callInfo.callSource,
        signature: cmdSig
      })
      this.lastCommandSig = cmdSig
    }

    try {
      const result = originalMethod(...args)

      // Capture command after execution
      const stackFrame = this.commandStack[this.commandStack.length - 1]
      if (
        stackFrame?.command === methodName &&
        stackFrame.signature === cmdSig
      ) {
        this.commandStack.pop()
        this.captureCommandResult(
          methodName,
          args,
          result,
          callInfo.callSource,
          browser,
          browserAny
        )
      }

      return result
    } catch (error) {
      // Capture command error
      const stackFrame = this.commandStack[this.commandStack.length - 1]
      if (
        stackFrame?.command === methodName &&
        stackFrame.signature === cmdSig
      ) {
        this.commandStack.pop()
        this.captureCommandError(methodName, args, error, callInfo.callSource)
      }

      throw error
    }
  }

  /**
   * Capture command result
   */
  private captureCommandResult(
    methodName: string,
    args: any[],
    result: any,
    callSource: string | undefined,
    browser: NightwatchBrowser,
    browserAny: any
  ): void {
    const currentTest = this.getCurrentTest()
    if (!currentTest) {
      return
    }

    // Serialize result
    let serializedResult: any = undefined
    const isBrowserObject = result === browser || result === browserAny
    const isChainableAPI =
      result &&
      typeof result === 'object' &&
      ('queue' in result || 'sessionId' in result || 'capabilities' in result)

    if (isBrowserObject || isChainableAPI) {
      const isWaitCommand = methodName.startsWith('waitFor')
      serializedResult = isWaitCommand ? true : undefined
    } else if (result && typeof result === 'object') {
      if ('value' in result) {
        serializedResult = result.value
      } else {
        try {
          serializedResult = JSON.parse(JSON.stringify(result))
        } catch {
          serializedResult = String(result)
        }
      }
    } else if (result !== undefined) {
      serializedResult = result
    }

    // Capture and send command immediately
    this.sessionCapturer
      .captureCommand(
        methodName,
        args,
        serializedResult,
        undefined,
        currentTest.uid,
        callSource
      )
      .catch((err: any) =>
        log.error(`Failed to capture ${methodName}: ${err.message}`)
      )

    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.sessionCapturer.sendCommand(lastCommand)
    }
  }

  /**
   * Capture command error
   */
  private captureCommandError(
    methodName: string,
    args: any[],
    error: any,
    callSource: string | undefined
  ): void {
    const currentTest = this.getCurrentTest()
    if (!currentTest) {
      return
    }

    this.sessionCapturer
      .captureCommand(
        methodName,
        args,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        currentTest.uid,
        callSource
      )
      .catch((err: any) =>
        log.error(`Failed to capture ${methodName}: ${err.message}`)
      )

    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.sessionCapturer.sendCommand(lastCommand)
    }
  }

  /**
   * Check if browser is already proxied
   */
  isProxied(): boolean {
    return this.browserProxied
  }
}
