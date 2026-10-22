import logger from '@wdio/logger'
import { InterceptorNetworkPoller } from '@wdio/devtools-core'
import { isNativeAppSession } from '@wdio/devtools-shared'
import type { Capabilities } from '@wdio/types'
import type { SessionCapturer } from './session.js'
import { resolveWebDriverAddress } from './webdriver-address.js'

const log = logger('@wdio/devtools-service:interceptedNetwork')

/** Native app network from appium-interceptor's proxy, for a session that asked for it with `appium:intercept`. */
export class InterceptedNetwork {
  #requested: boolean
  #capturer: SessionCapturer
  #poller?: Pick<InterceptorNetworkPoller, 'drain'>

  constructor(
    requestedCaps: Capabilities.RequestedStandaloneCapabilities | undefined,
    capturer: SessionCapturer
  ) {
    this.#requested =
      requestedCaps !== undefined &&
      'appium:intercept' in requestedCaps &&
      requestedCaps['appium:intercept'] === true
    this.#capturer = capturer
  }

  /** Called per session: a listener dies with its session, so `reloadSession` needs a new one. */
  async start(browser: WebdriverIO.Browser | undefined): Promise<void> {
    this.#poller = undefined
    if (
      !browser ||
      !this.#requested ||
      !isNativeAppSession(browser.capabilities)
    ) {
      return
    }
    const address = resolveWebDriverAddress(browser)
    if (!address || !browser.sessionId) {
      log.warn(
        'appium:intercept is set but the Appium address is not knowable; native network is not captured'
      )
      return
    }
    const poller = new InterceptorNetworkPoller(address, browser.sessionId)
    if (!(await poller.start())) {
      log.warn(
        'appium:intercept is set but the interceptor listener did not start; is Appium running with --use-plugins=appium-interceptor?'
      )
      return
    }
    log.info('Native network capture active via appium-interceptor')
    this.#poller = poller
  }

  /** Lists what the proxy recorded since the last call. */
  async forward(): Promise<void> {
    const requests = (await this.#poller?.drain()) ?? []
    if (requests.length === 0) {
      return
    }
    this.#capturer.recordNetworkRequests(requests)
  }
}
