import logger from '@wdio/logger'
import {
  NativeNetworkCapture,
  requestsInterceptedNetwork,
  webdriverExecute,
  type InterceptorExecute
} from '@wdio/devtools-core'
import type { Capabilities } from '@wdio/types'
import type { SessionCapturer } from './session.js'
import { resolveWebDriverAddress } from './webdriver-address.js'

const log = logger('@wdio/devtools-service:interceptedNetwork')

/** WDIO glue over core's native network capture, for a session that asked for it with `appium:intercept`. */
export class InterceptedNetwork {
  #requested: boolean
  #capture: NativeNetworkCapture

  constructor(
    requestedCaps: Capabilities.RequestedStandaloneCapabilities | undefined,
    capturer: SessionCapturer
  ) {
    this.#requested = requestsInterceptedNetwork(requestedCaps)
    this.#capture = new NativeNetworkCapture(capturer, (level, message) =>
      log[level](message)
    )
  }

  /** Called per session: a listener dies with its session, so `reloadSession` needs a new one. */
  start(browser: WebdriverIO.Browser | undefined): Promise<void> {
    return this.#capture.start(
      browser && {
        requested: this.#requested,
        capabilities: browser.capabilities,
        execute: executorFor(browser),
        unavailableReason: 'the Appium address is not knowable'
      }
    )
  }

  forward(options?: { throttle?: boolean }): Promise<void> {
    return this.#capture.forward(options)
  }
}

/** Raw WebDriver HTTP, so the plugin's commands never re-enter WDIO's hooks or render as action rows. */
function executorFor(
  browser: WebdriverIO.Browser
): InterceptorExecute | undefined {
  const address = resolveWebDriverAddress(browser)
  const sessionId = browser.sessionId
  if (!address || !sessionId) {
    return undefined
  }
  return (script, args) => webdriverExecute(address, sessionId, script, args)
}
