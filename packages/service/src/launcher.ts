import { remote } from 'webdriverio'
import { start } from '@wdio/devtools-backend'
import logger from '@wdio/logger'
import { DEFAULT_LAUNCH_CAPS } from './constants.ts'
import type { ServiceOptions, ExtendedCapabilities } from './types.js'

const log = logger('@wdio/devtools-service:Launcher')
export class DevToolsAppLauncher {
  #options: ServiceOptions
  #browser?: WebdriverIO.Browser

  constructor (options: ServiceOptions) {
    this.#options = options
  }

  async onPrepare (_: never, caps: ExtendedCapabilities[]) {
    try {
      const { server } = await start({
        port: this.#options.port,
        hostname: this.#options.hostname
      })
      const address = server.address()
      const port = address && typeof address === 'object'
        ? address.port
        : undefined

      if (!port) {
        return console.log(`Failed to start server on port ${port}`)
      }

      this.#updateCapabilities(caps, { port })
      this.#browser = await remote({
        automationProtocol: 'devtools',
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
    if (this.#browser) {
      logger.setLevel('devtools', 'warn')
      log.info('Please close the browser window to finish...');
      while (true) {
        try {
          await this.#browser.getTitle();
          await new Promise(res => setTimeout(res, 1000));
        } catch (e) {
          log.info('Browser window closed, stopping DevTools app');
          break;
        }
      }
      try {
        await this.#browser.deleteSession();
      } catch (err: any) {
        log.warn('Session already closed or could not be deleted:', err.message);
      }
    }
  }

  #updateCapabilities (caps: ExtendedCapabilities[], devtoolsApp: { port: number }) {
    /**
     * we don't support multiremote yet
     */
    if (!Array.isArray(caps)) {
      return
    }

    for (const cap of caps) {
      cap['wdio:devtoolsOptions'] = {
        port: devtoolsApp.port,
        hostname: 'localhost'
      }
    }
  }
}
