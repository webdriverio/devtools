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
  ElementOriginals,
  SeleniumDriverLike
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

/** Shape of the selenium-webdriver module surface we touch. */
interface SeleniumModule {
  Builder?: ConstructorLike
  WebDriver?: ConstructorLike
  WebElement?: ConstructorLike
}
interface ConstructorLike {
  prototype: object
}

// Resolve user's selenium-webdriver first, then fall back to our own.
function loadSeleniumWebdriver(): SeleniumModule | null {
  try {
    const userRequire = createRequire(`${process.cwd()}/`)
    return userRequire('selenium-webdriver') as SeleniumModule
  } catch {
    try {
      const localRequire = createRequire(import.meta.url)
      return localRequire('selenium-webdriver') as SeleniumModule
    } catch (err) {
      log.warn(
        `selenium-webdriver not found — devtools auto-attach disabled. (${errorMessage(err)})`
      )
      return null
    }
  }
}

export function isWebElementLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') {
    return false
  }
  const o = v as { getId?: unknown; click?: unknown }
  return typeof o.getId === 'function' && typeof o.click === 'function'
}

export function safeSerialize(value: unknown): unknown {
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
    const v = value as { using: string; value: unknown }
    return `By.${v.using}(${JSON.stringify(v.value)})`
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

export function webElementSummary(el: unknown): string {
  // `id_` is a Promise; some selenium versions stash the resolved value sync.
  const id = (el as { id_?: { _value?: unknown; value?: unknown } } | null)?.id_
  const peek = id?._value ?? id?.value ?? null
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
    const settle = (result: unknown, error: Error | undefined) => {
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

    let result: unknown
    try {
      result = original.apply(this, args)
    } catch (err) {
      settle(undefined, err as Error)
      throw err
    }

    // CRITICAL: return the original thenable. findElement returns a
    // WebElementPromise that carries sendKeys/click for chaining; a plain
    // Promise from `.then(...)` would break `findElement(...).sendKeys(...)`.
    const thenable = result as { then?: PromiseLike<unknown>['then'] } | null
    if (thenable && typeof thenable.then === 'function') {
      thenable.then(
        (v: unknown) => settle(v, undefined),
        (err: unknown) => settle(undefined, err as Error)
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

function stashDriverOriginals(driverProto: Patchable): void {
  const ts = driverProto.takeScreenshot
  if (typeof ts === 'function') {
    const orig = ts as (this: unknown) => unknown
    originals.takeScreenshot = (driver) => orig.call(driver) as Promise<string>
  }
  const es = driverProto.executeScript
  if (typeof es === 'function') {
    const orig = es as (
      this: unknown,
      script: string,
      ...args: unknown[]
    ) => unknown
    originals.executeScript = (driver, script, ...args) =>
      orig.call(driver, script, ...args) as Promise<unknown>
  }
  const mg = driverProto.manage
  if (typeof mg === 'function') {
    const orig = mg as (this: unknown) => unknown
    originals.manage = (driver) =>
      orig.call(driver) as ReturnType<typeof orig> & object
  }
}

// Lets onBeforeQuit flush async cleanup before runners that `process.exit()`
// tear down (those bypass node's beforeExit).
function patchDriverQuit(
  driverProto: Patchable,
  hooks: DriverPatcherHooks
): void {
  const quit = driverProto.quit
  if (typeof quit !== 'function') {
    return
  }
  const originalQuit = quit as (this: unknown) => unknown
  driverProto.quit = async function patchedQuit(this: unknown) {
    if (hooks.onBeforeQuit) {
      try {
        await hooks.onBeforeQuit(this as SeleniumDriverLike)
      } catch (err) {
        log.warn(`onBeforeQuit hook threw: ${errorMessage(err)}`)
      }
    }
    return originalQuit.call(this)
  }
  log.info('Wrapped WebDriver.quit (cleanup hook)')
}

function patchWebElement(
  WebElement: ConstructorLike,
  hooks: DriverPatcherHooks
): void {
  const elProto = WebElement.prototype as Patchable
  const gt = elProto.getText
  if (typeof gt === 'function') {
    const orig = gt as (this: unknown) => unknown
    elementOriginals.getText = (el) => orig.call(el) as Promise<string>
  }
  const gtn = elProto.getTagName
  if (typeof gtn === 'function') {
    const orig = gtn as (this: unknown) => unknown
    elementOriginals.getTagName = (el) => orig.call(el) as Promise<string>
  }
  const wrappedEl = wrapPrototype(
    WebElement.prototype,
    TRACKED_ELEMENT_METHODS,
    /* fromElement */ true,
    hooks
  )
  log.info(`Wrapped ${wrappedEl.length} WebElement method(s)`)
}

function patchBuilder(
  Builder: ConstructorLike,
  hooks: DriverPatcherHooks
): void {
  const builderProto = Builder.prototype as Patchable
  if (builderProto[PATCHED_SYMBOL]) {
    return
  }
  builderProto[PATCHED_SYMBOL] = true
  const originalBuild = builderProto.build as (
    this: unknown,
    ...args: unknown[]
  ) => unknown
  builderProto.build = function patchedBuild(
    this: unknown,
    ...args: unknown[]
  ) {
    if (hooks.onBeforeBuild) {
      try {
        hooks.onBeforeBuild(this)
      } catch (err) {
        log.warn(`onBeforeBuild hook threw: ${errorMessage(err)}`)
      }
    }
    const driver = originalBuild.apply(this, args) as SeleniumDriverLike
    let onDriverCreatedPromise: Promise<unknown> | undefined
    try {
      const result = hooks.onDriverCreated(driver)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        // Capture so the `await new Builder().build()` thenable patch
        // below can also wait on session setup (screencast / BiDi / metadata).
        // Without this, the user's test body fires the moment waitForReady()
        // resolves — which for the SECOND test is "immediately" because the
        // dashboard UI is already connected — and races against an in-flight
        // screencast.start(). Net effect: missing 2nd-test video.
        const p = (result as Promise<unknown>).catch((err) => {
          log.warn(`onDriverCreated hook rejected: ${errorMessage(err)}`)
        })
        onDriverCreatedPromise = p
      }
    } catch (err) {
      log.warn(`onDriverCreated hook threw: ${errorMessage(err)}`)
    }
    extendDriverThenable(driver, hooks, onDriverCreatedPromise)
    return driver
  }
  log.info('Patched Builder.prototype.build')
}

// Selenium 4: WebDriver is thenable. Extend `.then` so `await Builder.build()`
// also waits for (a) the dashboard to connect AND (b) the in-flight session
// setup from `onDriverCreated` (screencast + BiDi + metadata). Without (b),
// the user's test body races against capture wiring on fast tests.
// Selenium 3 may not be thenable — cast once.
function extendDriverThenable(
  driver: unknown,
  hooks: DriverPatcherHooks,
  onDriverCreatedPromise: Promise<unknown> | undefined
): void {
  const d = driver as Patchable
  const isThenable = driver && typeof d.then === 'function'
  if (!isThenable) {
    return
  }
  if (!hooks.waitForReady && !onDriverCreatedPromise) {
    return
  }
  const originalThen = (d.then as (...args: unknown[]) => unknown).bind(driver)
  d.then = function patchedThen(
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) {
    return originalThen(async (resolved: unknown) => {
      // Wait for both UI readiness and session-setup completion in parallel.
      // Either can fail — don't block forever on UI or capture issues.
      const waiters: Promise<unknown>[] = []
      if (hooks.waitForReady) {
        waiters.push(hooks.waitForReady().catch(() => {}))
      }
      if (onDriverCreatedPromise) {
        waiters.push(onDriverCreatedPromise.catch(() => {}))
      }
      await Promise.all(waiters)
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
  stashDriverOriginals(WebDriver.prototype as Patchable)

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

  patchDriverQuit(WebDriver.prototype as Patchable, hooks)
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
