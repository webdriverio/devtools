import logger from '@wdio/logger'
import { errorMessage, resolveViewport } from '@wdio/devtools-core'
import { TraceType } from '@wdio/devtools-shared'
import { SELENIUM_RUNNER_ID } from '../constants.js'
import { getDriverOriginals } from '../driverPatcher.js'
import type { SeleniumDriverLike } from '../types.js'

const log = logger('@wdio/selenium-devtools:driverMetadata')

export interface DriverMetadataInput {
  driver: SeleniumDriverLike
  driverReadyTs: number
  /** The JS test runner `detectRunner` found (mocha/jest/cucumber). Distinct
   *  from `Metadata.runner`, which names this adapter for every one of them. */
  detectedRunner: string | null
  rerunCommand?: string
  rerunTemplate?: string
  launchCommand?: string
}

export interface DriverMetadataResult {
  sessionId: string | undefined
  /** Upstream `metadata` payload to forward to the dashboard. */
  metadata: Record<string, unknown> | undefined
}

type CapGet = (k: string) => unknown

/**
 * A plain bag from selenium's `Capabilities`, whose data lives in a private
 * Map. It exposes `serialize` only under a Symbol, so a string-keyed
 * `serialize?.()` is `undefined` and the instance itself JSON-serializes to
 * `{"map_":{}}` — which is what the dashboard has been receiving as a
 * Selenium run's capabilities, and why its traces carried no `device` and
 * fell back to a guessed browser name. Everything downstream reads
 * capabilities as a bag, so the one conversion happens here.
 */
function serializeCapabilities(capabilities: unknown): Record<string, unknown> {
  const caps = capabilities as
    | {
        keys?: () => Iterable<string>
        get?: (k: string) => unknown
        serialize?: () => Record<string, unknown>
      }
    | undefined
  if (typeof caps?.keys === 'function' && typeof caps.get === 'function') {
    const get = caps.get.bind(caps)
    return Object.fromEntries([...caps.keys()].map((key) => [key, get(key)]))
  }
  return caps?.serialize?.() ?? (capabilities as Record<string, unknown>) ?? {}
}

function makeCapGet(capabilities: unknown): CapGet {
  return (k: string) => {
    const caps = capabilities as
      | {
          get?: (k: string) => unknown
          serialize?: () => Record<string, unknown>
        }
      | undefined
    if (caps?.get && typeof caps.get === 'function') {
      return caps.get(k)
    }
    const serialized =
      caps?.serialize?.() ?? (caps as Record<string, unknown>) ?? {}
    return serialized[k]
  }
}

function logBrowserBoot(
  capGet: CapGet,
  sessionId: string | undefined,
  driverReadyTs: number
): void {
  const browserName = capGet('browserName') ?? 'unknown'
  const browserVersion = capGet('browserVersion') ?? capGet('version') ?? ''
  const platform = capGet('platformName') ?? capGet('platform') ?? ''
  log.info(
    `🌐 Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''}${platform ? ' on ' + platform : ''} (sessionId: ${sessionId ?? 'unknown'})`
  )
  const webSocketUrl = capGet('webSocketUrl')
  const chromeOpts =
    (capGet('goog:chromeOptions') as { args?: unknown } | undefined) ?? {}
  const chromeArgs: string[] = Array.isArray(chromeOpts.args)
    ? (chromeOpts.args as string[])
    : []
  const headlessArg = chromeArgs.find((a) => a.startsWith('--headless'))
  log.info(
    `📋 Capabilities sent: browserName=${browserName}, webSocketUrl=${webSocketUrl ? 'on' : 'off'}` +
      (headlessArg ? `, ${headlessArg}` : '') +
      (chromeArgs.length ? `, chromeArgs=${chromeArgs.length}` : '')
  )
  log.info(`Driver session created in ${Date.now() - driverReadyTs}ms`)
}

/**
 * The run's geometry, read through the UNPATCHED driver methods: selenium
 * implements both as ordinary commands, so the patched ones would open every
 * run with an `executeScript` or `getWindowRect` row of our own making.
 */
function readViewport(driver: SeleniumDriverLike, capabilities: unknown) {
  const orig = getDriverOriginals()
  return resolveViewport(capabilities, {
    runScript: orig.executeScript
      ? (body) => orig.executeScript!(driver, body)
      : undefined,
    getWindowSize: orig.manage
      ? async () => {
          // `manage()` is typed as unknown here — the window handle is a
          // selenium internal this package deliberately does not model.
          const window = (
            orig.manage!(driver) as {
              window?: () => { getRect?: () => unknown }
            }
          ).window?.()
          return window?.getRect?.()
        }
      : undefined,
    onWarn: (message) => log.warn(message)
  })
}

/**
 * Extract session id + a fully-built upstream-metadata payload from a freshly
 * created Selenium driver. Logs the standard `Browser:`/`Capabilities sent:`/
 * `Driver session created in ...` lines as a side effect (these are part of
 * the visible boot sequence; suppressing them would surprise users). Returns
 * `metadata: undefined` if the driver couldn't be queried.
 */
export async function buildDriverMetadata(
  input: DriverMetadataInput
): Promise<DriverMetadataResult> {
  const { driver, driverReadyTs, detectedRunner } = input
  try {
    const session = driver.getSession ? await driver.getSession() : undefined
    const capabilities = driver.getCapabilities
      ? await driver.getCapabilities()
      : undefined
    const sessionId = session?.getId?.() ?? undefined
    const capGet = makeCapGet(capabilities)
    logBrowserBoot(capGet, sessionId, driverReadyTs)
    const caps = serializeCapabilities(capabilities)
    const viewport = await readViewport(driver, caps)
    return {
      sessionId,
      metadata: {
        type: TraceType.Testrunner,
        capabilities: caps,
        ...(viewport ? { viewport } : {}),
        sessionId,
        runner: SELENIUM_RUNNER_ID,
        options: {
          baseDir: process.cwd(),
          rerunCommand: input.rerunCommand ?? input.rerunTemplate,
          launchCommand: input.launchCommand,
          // Cucumber `--name` filters scenarios but not Gherkin steps, so
          // leaf-step rerun stays disabled there.
          runCapabilities: {
            canRunSuites: true,
            canRunTests: detectedRunner !== 'cucumber',
            canRunAll: true
          }
        }
      }
    }
  } catch (err) {
    log.warn(`Failed to send metadata: ${errorMessage(err)}`)
    return { sessionId: undefined, metadata: undefined }
  }
}
