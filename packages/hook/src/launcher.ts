import { remote } from 'webdriverio'
import { start } from '@wdio/devtools-backend'

import { DEFAULT_LAUNCH_CAPS } from './constants.ts'
import type { ServiceOptions } from './types.js'

export class DevToolsAppLauncher {
  #options: ServiceOptions
  #browser?: WebdriverIO.Browser

  constructor (options: ServiceOptions) {
    this.#options = options
  }

  async onPrepare () {
    try {
      const { server } = await start({ port: this.#options.port })
      const address = server.address()
      const port = address && typeof address === 'object'
        ? address.port
        : undefined

      if (!port) {
        console.log(`Failed to start server on port ${port}`)
      }

      this.#browser = await remote({
        capabilities: {
          ...DEFAULT_LAUNCH_CAPS,
          ...this.#options.devtoolsCapabilities
        }
      })
      await this.#browser.url(`http://localhost:${port}`)
    } catch (err) {
      console.error(err)
    }
  }

  async onComplete () {
    await this.#browser?.deleteSession()
  }
}
