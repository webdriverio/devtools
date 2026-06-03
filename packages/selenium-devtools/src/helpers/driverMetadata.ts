import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { TraceType } from '@wdio/devtools-shared'
import type { SeleniumDriverLike } from '../types.js'

const log = logger('@wdio/selenium-devtools:driverMetadata')

export interface DriverMetadataInput {
  driver: SeleniumDriverLike
  driverReadyTs: number
  runner: string | null
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
 * Extract session id + a fully-built upstream-metadata payload from a freshly
 * created Selenium driver. Logs the standard `Browser:`/`Capabilities sent:`/
 * `Driver session created in ...` lines as a side effect (these are part of
 * the visible boot sequence; suppressing them would surprise users). Returns
 * `metadata: undefined` if the driver couldn't be queried.
 */
export async function buildDriverMetadata(
  input: DriverMetadataInput
): Promise<DriverMetadataResult> {
  const { driver, driverReadyTs, runner } = input
  try {
    const session = driver.getSession ? await driver.getSession() : undefined
    const capabilities = driver.getCapabilities
      ? await driver.getCapabilities()
      : undefined
    const sessionId = session?.getId?.() ?? undefined
    const capGet = makeCapGet(capabilities)
    logBrowserBoot(capGet, sessionId, driverReadyTs)
    return {
      sessionId,
      metadata: {
        type: TraceType.Testrunner,
        capabilities: capabilities?.serialize?.() ?? capabilities ?? {},
        sessionId,
        options: {
          framework: 'selenium-webdriver',
          baseDir: process.cwd(),
          rerunCommand: input.rerunCommand ?? input.rerunTemplate,
          launchCommand: input.launchCommand,
          // Cucumber `--name` filters scenarios but not Gherkin steps, so
          // leaf-step rerun stays disabled there.
          runCapabilities: {
            canRunSuites: true,
            canRunTests: runner !== 'cucumber',
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
