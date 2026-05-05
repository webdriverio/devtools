import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import {
  INTERNAL_DRIVER_METHODS,
  PATCHED_SYMBOL,
  TRACKED_ELEMENT_METHODS
} from './constants.js'
import { getCallSourceFromStack } from './helpers/utils.js'
import type {
  DriverOriginals,
  DriverPatcherHooks,
  ElementOriginals
} from './types.js'

const log = logger('@wdio/selenium-devtools:driverPatcher')

const originals: DriverOriginals = {}
const elementOriginals: ElementOriginals = {}

export function getDriverOriginals(): DriverOriginals {
  return originals
}

export function getElementOriginals(): ElementOriginals {
  return elementOriginals
}

// Resolve user's selenium-webdriver first, then fall back to our own.
function loadSeleniumWebdriver(): any | null {
  try {
    const userRequire = createRequire(`${process.cwd()}/`)
    return userRequire('selenium-webdriver')
  } catch {
    try {
      const localRequire = createRequire(import.meta.url)
      return localRequire('selenium-webdriver')
    } catch (err) {
      log.warn(
        `selenium-webdriver not found — devtools auto-attach disabled. (${(err as Error).message})`
      )
      return null
    }
  }
}

function isWebElementLike(v: any): boolean {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.getId === 'function' &&
    typeof v.click === 'function'
  )
}

function safeSerialize(value: any): any {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'function') {
    return '[Function]'
  }
  if (isWebElementLike(value)) {
    return webElementSummary(value)
  }
  if (
    typeof value === 'object' &&
    'using' in value &&
    'value' in value &&
    Object.keys(value).length === 2
  ) {
    return `By.${value.using}(${JSON.stringify(value.value)})`
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isWebElementLike)) {
      return `<WebElement[]> (count: ${value.length})`
    }
    return value.map(safeSerialize)
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }
  return value
}

function webElementSummary(el: any): string {
  // `id_` is a Promise; some selenium versions stash the resolved value sync.
  const peek = el?.id_?._value ?? el?.id_?.value ?? null
  return peek ? `<WebElement id=${peek}>` : '<WebElement>'
}

function wrapPrototype(
  proto: object,
  methodNames: Iterable<string>,
  fromElement: boolean,
  hooks: DriverPatcherHooks
): string[] {
  if ((proto as any)[PATCHED_SYMBOL]) {
    return []
  }
  ;(proto as any)[PATCHED_SYMBOL] = true

  const wrapped: string[] = []
  for (const methodName of methodNames) {
    const original = (proto as any)[methodName]
    if (typeof original !== 'function') {
      continue
    }
    if (methodName === 'constructor' || methodName.startsWith('__')) {
      continue
    }

    ;(proto as any)[methodName] = function (...args: any[]): any {
      const callInfo = getCallSourceFromStack()
      const startedAt = Date.now()
      const sanitizedArgs = args.map(safeSerialize)
      const settle = (result: any, error: Error | undefined) => {
        try {
          hooks.onCommand({
            command: methodName,
            args: sanitizedArgs,
            result: error ? undefined : safeSerialize(result),
            rawResult: error ? undefined : result,
            error,
            callSource: callInfo.callSource,
            timestamp: startedAt,
            fromElement
          })
        } catch (hookErr) {
          log.warn(
            `onCommand hook threw for ${methodName}: ${(hookErr as Error).message}`
          )
        }
      }

      let result: any
      try {
        result = original.apply(this, args)
      } catch (err) {
        settle(undefined, err as Error)
        throw err
      }

      // CRITICAL: return the original thenable. findElement returns a
      // WebElementPromise that carries sendKeys/click for chaining; a plain
      // Promise from `.then(...)` would break `findElement(...).sendKeys(...)`.
      if (result && typeof result.then === 'function') {
        result.then(
          (v: any) => settle(v, undefined),
          (err: any) => settle(undefined, err as Error)
        )
        return result
      }
      settle(result, undefined)
      return result
    }

    wrapped.push(methodName)
  }
  return wrapped
}

export function patchSelenium(hooks: DriverPatcherHooks): boolean {
  const sw = loadSeleniumWebdriver()
  if (!sw) {
    return false
  }

  const Builder = sw.Builder
  const WebDriver = sw.WebDriver
  const WebElement = sw.WebElement

  if (!Builder || !WebDriver) {
    log.warn(
      'selenium-webdriver loaded but Builder/WebDriver missing — version unsupported?'
    )
    return false
  }

  // Stash unwrapped originals before any patching.
  const driverProto = WebDriver.prototype
  if (typeof driverProto.takeScreenshot === 'function') {
    const orig = driverProto.takeScreenshot
    originals.takeScreenshot = (driver) => orig.call(driver)
  }
  if (typeof driverProto.executeScript === 'function') {
    const orig = driverProto.executeScript
    originals.executeScript = (driver, script, ...args) =>
      orig.call(driver, script, ...args)
  }
  if (typeof driverProto.manage === 'function') {
    const orig = driverProto.manage
    originals.manage = (driver) => orig.call(driver)
  }

  const driverMethods = collectMethodNames(WebDriver.prototype)
  const tracked = driverMethods.filter(
    (m) => !INTERNAL_DRIVER_METHODS.includes(m as any)
  )
  const wrappedDriver = wrapPrototype(
    WebDriver.prototype,
    tracked,
    /* fromElement */ false,
    hooks
  )
  log.info(`Wrapped ${wrappedDriver.length} WebDriver method(s)`)

  // Lets onBeforeQuit flush async cleanup before runners that `process.exit()`
  // tear down (those bypass node's beforeExit).
  if (typeof driverProto.quit === 'function') {
    const originalQuit = driverProto.quit
    driverProto.quit = async function patchedQuit(this: any) {
      if (hooks.onBeforeQuit) {
        try {
          await hooks.onBeforeQuit(this)
        } catch (err) {
          log.warn(`onBeforeQuit hook threw: ${(err as Error).message}`)
        }
      }
      return originalQuit.call(this)
    }
    log.info('Wrapped WebDriver.quit (cleanup hook)')
  }

  if (WebElement) {
    const elProto = WebElement.prototype
    if (typeof elProto.getText === 'function') {
      const orig = elProto.getText
      elementOriginals.getText = (el) => orig.call(el)
    }
    if (typeof elProto.getTagName === 'function') {
      const orig = elProto.getTagName
      elementOriginals.getTagName = (el) => orig.call(el)
    }

    const wrappedEl = wrapPrototype(
      WebElement.prototype,
      TRACKED_ELEMENT_METHODS,
      /* fromElement */ true,
      hooks
    )
    log.info(`Wrapped ${wrappedEl.length} WebElement method(s)`)
  }

  if (!(Builder.prototype as any)[PATCHED_SYMBOL]) {
    ;(Builder.prototype as any)[PATCHED_SYMBOL] = true
    const originalBuild = Builder.prototype.build
    Builder.prototype.build = function patchedBuild(this: any, ...args: any[]) {
      if (hooks.onBeforeBuild) {
        try {
          hooks.onBeforeBuild(this)
        } catch (err) {
          log.warn(`onBeforeBuild hook threw: ${(err as Error).message}`)
        }
      }
      const driver = originalBuild.apply(this, args)
      try {
        const result = hooks.onDriverCreated(driver)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          ;(result as Promise<unknown>).catch((err) =>
            log.warn(`onDriverCreated hook rejected: ${(err as Error).message}`)
          )
        }
      } catch (err) {
        log.warn(`onDriverCreated hook threw: ${(err as Error).message}`)
      }

      // Selenium 4: WebDriver is thenable. Extend `.then` so `await Builder.build()`
      // also waits for the dashboard to connect.
      const isThenable = driver && typeof (driver as any).then === 'function'
      if (isThenable && hooks.waitForReady) {
        const originalThen = (driver as any).then.bind(driver)
        ;(driver as any).then = function patchedThen(
          onFulfilled?: (value: any) => any,
          onRejected?: (reason: any) => any
        ) {
          return originalThen(async (resolved: any) => {
            try {
              await hooks.waitForReady!()
            } catch {
              /* fall through — don't block forever on UI failures */
            }
            return onFulfilled ? onFulfilled(resolved) : resolved
          }, onRejected)
        }
      }

      return driver
    }
    log.info('Patched Builder.prototype.build')
  }

  return true
}

function collectMethodNames(proto: object): string[] {
  const names = new Set<string>()
  let current = proto
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      const desc = Object.getOwnPropertyDescriptor(current, name)
      if (desc && typeof desc.value === 'function') {
        names.add(name)
      }
    }
    current = Object.getPrototypeOf(current)
  }
  return [...names]
}
