// Compiled, never run: it exists so tsc checks the published declarations
// against the WebdriverIO types this project installed.
import { remote } from 'webdriverio'
import type { Options } from '@wdio/types'
import DevToolsHookService, {
  setupForDevtools,
  type ServiceOptions
} from '@wdio/devtools-service'
import { getElements, getSnapshot, type SnapshotResult } from '@wdio/elements'
import { xmlToJSON } from '@wdio/elements/locators'

const serviceOptions: ServiceOptions = {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  devtoolsCapabilities: { browserName: 'chrome' }
}

export const config: WebdriverIO.Config = {
  specs: ['./test/**/*.ts'],
  capabilities: [{ browserName: 'chrome' }],
  framework: 'mocha',
  services: [
    ['devtools', serviceOptions],
    [DevToolsHookService, serviceOptions]
  ]
}

export async function standalone(opts: Options.WebdriverIO): Promise<void> {
  const browser = await remote({
    ...setupForDevtools(opts),
    capabilities: { browserName: 'chrome' }
  })
  await browser.deleteSession()
}

export async function elements(
  browser: WebdriverIO.Browser
): Promise<SnapshotResult> {
  await getElements(browser, { inViewportOnly: false })
  xmlToJSON('<hierarchy />')
  return getSnapshot(browser, { inViewportOnly: false })
}
