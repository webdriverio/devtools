import logger from '@wdio/logger'
import type { ScreencastOptions } from '../types.js'
import type { RerunManager } from '../rerunManager.js'

const log = logger('@wdio/selenium-devtools:configSummary')

export interface ConfigSummaryInput {
  openUi: boolean
  headless: boolean
  captureScreenshots: boolean
  rerunCommand?: string
  screencast: ScreencastOptions
  rerunManager: RerunManager
}

/**
 * Single-line summary of the plugin's effective config — useful when
 * debugging a misconfigured env, gated so it runs at most once per process.
 */
export function logConfigSummary(input: ConfigSummaryInput): void {
  const screencast = input.screencast.enabled
    ? `${input.screencast.maxWidth}x${input.screencast.maxHeight}@q${input.screencast.quality}`
    : 'off'
  const rerun = input.rerunCommand
    ? 'custom'
    : input.rerunManager.rerunTemplate
      ? 'auto'
      : 'launch-only'
  log.info(
    `Configuration: openUi=${input.openUi}, headless=${input.headless}, ` +
      `screencast=${screencast}, captureScreenshots=${input.captureScreenshots}, ` +
      `rerun=${rerun}`
  )
}
