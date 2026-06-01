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
  const { driver, driverReadyTs, runner, rerunCommand, rerunTemplate, launchCommand } =
    input

  try {
    const session = driver.getSession ? await driver.getSession() : undefined
    const capabilities = driver.getCapabilities
      ? await driver.getCapabilities()
      : undefined
    const sessionId = session?.getId?.() ?? undefined
    const capGet = (k: string): any => {
      if (capabilities?.get && typeof capabilities.get === 'function') {
        return capabilities.get(k)
      }
      const serialized = capabilities?.serialize?.() ?? capabilities ?? {}
      return serialized[k]
    }
    const browserName = capGet('browserName') ?? 'unknown'
    const browserVersion = capGet('browserVersion') ?? capGet('version') ?? ''
    const platform = capGet('platformName') ?? capGet('platform') ?? ''
    log.info(
      `🌐 Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''}${platform ? ' on ' + platform : ''} (sessionId: ${sessionId ?? 'unknown'})`
    )
    const webSocketUrl = capGet('webSocketUrl')
    const chromeOpts = capGet('goog:chromeOptions') ?? {}
    const chromeArgs: string[] = Array.isArray(chromeOpts?.args)
      ? chromeOpts.args
      : []
    const headlessArg = chromeArgs.find((a) => a.startsWith('--headless'))
    log.info(
      `📋 Capabilities sent: browserName=${browserName}, webSocketUrl=${webSocketUrl ? 'on' : 'off'}` +
        (headlessArg ? `, ${headlessArg}` : '') +
        (chromeArgs.length ? `, chromeArgs=${chromeArgs.length}` : '')
    )
    log.info(`Driver session created in ${Date.now() - driverReadyTs}ms`)

    return {
      sessionId,
      metadata: {
        type: TraceType.Testrunner,
        capabilities: capabilities?.serialize?.() ?? capabilities ?? {},
        sessionId,
        options: {
          framework: 'selenium-webdriver',
          baseDir: process.cwd(),
          rerunCommand: rerunCommand ?? rerunTemplate,
          launchCommand,
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
