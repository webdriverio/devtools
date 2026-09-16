// Where this session's driver is reachable, for the probes that must not go
// back through WDIO's own command path. See `core/webdriver-http.ts` for why.

import logger from '@wdio/logger'
import type { WebDriverAddress } from '@wdio/devtools-core'

const log = logger('@wdio/devtools-service:webdriverAddress')

/** WDIO's connection options, which are on the runtime `browser` but not on
 *  its published type. Spelled once here rather than at each read. */
type ConnectionOptions = {
  protocol?: string
  hostname?: string
  port?: number
  path?: string
  user?: string
  key?: string
  headers?: Record<string, string>
}

/**
 * The address WDIO built this session against, or undefined when it is not
 * knowable — a session created by something other than the standard connection
 * options, where guessing localhost would send a probe to the wrong driver.
 *
 * `user`/`key` carry through because a cloud grid answers 401 without them,
 * and a probe that silently 401s is a capture gap rather than a visible error.
 */
export function resolveWebDriverAddress(
  browser: WebdriverIO.Browser
): WebDriverAddress | undefined {
  const options = browser.options as ConnectionOptions | undefined
  const hostname = options?.hostname
  const port = options?.port
  if (!hostname || !port) {
    return undefined
  }
  return {
    hostname,
    port,
    protocol: options?.protocol,
    path: options?.path,
    user: options?.user,
    key: options?.key,
    headers: options?.headers,
    onWarn: (message: string) => log.warn(message)
  }
}
