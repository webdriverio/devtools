import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
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
        `selenium-webdriver not found — devtools auto-attach disabled. (${errorMessage(err)})`
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

// Selenium prototypes (WebDriver/WebElement/Builder) carry methods we patch
// dynamically — Reflect.{get,set} keeps the casts to a single location and
// drops per-line `as any`.
type Patchable = Record<string | symbol, unknown>

function makeWrappedMethod(
  original: (...args: unknown[]) => unknown,
  methodName: string,
  fromElement: boolean,
  hooks: DriverPatcherHooks
): (...args: unknown[]) => unknown {
  return function (this: unknown, ...args: unknown[]): unknown {
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
}

function wrapPrototype(
  proto: object,
  methodNames: Iterable<string>,
  fromElement: boolean,
  hooks: DriverPatcherHooks
): string[] {
  const p = proto as Patchable
  if (p[PATCHED_SYMBOL]) {
    return []
  }
  p[PATCHED_SYMBOL] = true

  const wrapped: string[] = []
  for (const methodName of methodNames) {
    const original = p[methodName]
    if (typeof original !== 'function') {
      continue
    }
    if (methodName === 'constructor' || methodName.startsWith('__')) {
      continue
    }
    p[methodName] = makeWrappedMethod(
      original as (...args: unknown[]) => unknown,
      methodName,
      fromElement,
      hooks
    )
    wrapped.push(methodName)
  }
  return wrapped
}

function stashDriverOriginals(driverProto: any): void {
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
}

// Lets onBeforeQuit flush async cleanup before runners that `process.exit()`
// tear down (those bypass node's beforeExit).
function patchDriverQuit(driverProto: any, hooks: DriverPatcherHooks): void {
  if (typeof driverProto.quit !== 'function') {
    return
  }
  const originalQuit = driverProto.quit
  driverProto.quit = async function patchedQuit(this: any) {
    if (hooks.onBeforeQuit) {
      try {
        await hooks.onBeforeQuit(this)
      } catch (err) {
        log.warn(`onBeforeQuit hook threw: ${errorMessage(err)}`)
      }
    }
    return originalQuit.call(this)
  }
  log.info('Wrapped WebDriver.quit (cleanup hook)')
}

function patchWebElement(WebElement: any, hooks: DriverPatcherHooks): void {
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

function patchBuilder(Builder: any, hooks: DriverPatcherHooks): void {
  const builderProto = Builder.prototype as Patchable
  if (builderProto[PATCHED_SYMBOL]) {
    return
  }
  builderProto[PATCHED_SYMBOL] = true
  const originalBuild = Builder.prototype.build
  Builder.prototype.build = function patchedBuild(this: any, ...args: any[]) {
    if (hooks.onBeforeBuild) {
      try {
        hooks.onBeforeBuild(this)
      } catch (err) {
        log.warn(`onBeforeBuild hook threw: ${errorMessage(err)}`)
      }
    }
    const driver = originalBuild.apply(this, args)
    try {
      const result = hooks.onDriverCreated(driver)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).catch((err) =>
          log.warn(`onDriverCreated hook rejected: ${errorMessage(err)}`)
        )
      }
    } catch (err) {
      log.warn(`onDriverCreated hook threw: ${errorMessage(err)}`)
    }
    extendDriverThenable(driver, hooks)
    return driver
  }
  log.info('Patched Builder.prototype.build')
}

// Selenium 4: WebDriver is thenable. Extend `.then` so `await Builder.build()`
// also waits for the dashboard to connect. Selenium 3 may not be — cast once.
function extendDriverThenable(
  driver: unknown,
  hooks: DriverPatcherHooks
): void {
  const d = driver as Patchable
  const isThenable = driver && typeof d.then === 'function'
  if (!isThenable || !hooks.waitForReady) {
    return
  }
  const originalThen = (d.then as (...args: unknown[]) => unknown).bind(driver)
  d.then = function patchedThen(
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

export function patchSelenium(hooks: DriverPatcherHooks): boolean {
  const sw = loadSeleniumWebdriver()
  if (!sw) {
    return false
  }

  const { Builder, WebDriver, WebElement } = sw
  if (!Builder || !WebDriver) {
    log.warn(
      'selenium-webdriver loaded but Builder/WebDriver missing — version unsupported?'
    )
    return false
  }

  // Stash unwrapped originals before any patching.
  stashDriverOriginals(WebDriver.prototype)

  const tracked = collectMethodNames(WebDriver.prototype).filter(
    (m) => !(INTERNAL_DRIVER_METHODS as readonly string[]).includes(m)
  )
  const wrappedDriver = wrapPrototype(
    WebDriver.prototype,
    tracked,
    /* fromElement */ false,
    hooks
  )
  log.info(`Wrapped ${wrappedDriver.length} WebDriver method(s)`)

  patchDriverQuit(WebDriver.prototype, hooks)
  if (WebElement) {
    patchWebElement(WebElement, hooks)
  }
  patchBuilder(Builder, hooks)

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
