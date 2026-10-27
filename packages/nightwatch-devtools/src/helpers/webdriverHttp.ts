// Direct WebDriver HTTP transport for the capture probes.
//
// Every probe the trace capture makes — url, title, screenshot, in-page script
// — has to bypass Nightwatch's command queue. `browser.*` commands are QUEUED,
// so a probe the plugin issues from inside its own command hook enqueues behind
// the command that is still running and cannot resolve until the queue drains.
// Unguarded, one such probe stranded the whole per-action snapshot capture; the
// in-page script probe merely timed out, leaving empty a11y trees.

import logger from '@wdio/logger'
import {
  webdriverExecute as coreExecute,
  webdriverGet as coreGet,
  webdriverPost as corePost,
  type InterceptorExecute,
  type WebDriverAddress
} from '@wdio/devtools-core'
import type { NightwatchBrowser } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:webdriverHttp')

type LooseRec = Record<string, unknown>

const getProp = (obj: unknown, key: string): unknown =>
  obj && typeof obj === 'object' ? (obj as LooseRec)[key] : undefined

const getPath = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => getProp(acc, k), obj)

const firstDefined = (obj: unknown, ...keys: string[]): unknown => {
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  const rec = obj as LooseRec
  for (const k of keys) {
    const v = rec[k]
    if (v !== undefined && v !== null) {
      return v
    }
  }
  return undefined
}

interface ConfiguredWebDriver {
  host: unknown
  port: unknown
  pathPrefix: unknown
  ssl: unknown
  username: unknown
  accessKey: unknown
}

/** The driver settings as configured, with no defaults applied. */
function configuredWebDriver(browser: NightwatchBrowser): ConfiguredWebDriver {
  const transportSettings =
    getPath(browser, 'transport', 'settings', 'webdriver') ||
    getPath(browser, 'queue', 'transport', 'settings', 'webdriver') ||
    getPath(
      browser,
      'nightwatchInstance',
      'transport',
      'settings',
      'webdriver'
    ) ||
    {}
  const opts = getProp(browser, 'options') ?? {}
  const nightwatchSettings =
    getPath(browser, 'nightwatchInstance', 'settings') ||
    getPath(browser, 'globals', 'nightwatchInstance', 'settings') ||
    {}
  const sources = [
    transportSettings,
    getProp(opts, 'webdriver'),
    getProp(nightwatchSettings, 'webdriver')
  ]
  const values = (...keys: string[]) =>
    sources.map((source) => firstDefined(source, ...keys))
  const pick = (...keys: string[]) => values(...keys).find(Boolean)
  return {
    host: pick('host', 'server_address'),
    port: pick('port'),
    pathPrefix: pick('default_path_prefix'),
    // `ssl: false` is a setting, not an absence, so it must not fall through to a later source.
    ssl: values('ssl').find((v) => v !== undefined),
    username: pick('username'),
    accessKey: values('access_key').find((v) => v !== undefined)
  }
}

/** Nightwatch's own connection settings (`settings.js` `setWebdriverSettings`, `client.js` `setHttpOptions`): https when `ssl` is set or, unset, when the port is 443; basic auth when both `username` and `access_key` are. */
function connection(
  configured: ConfiguredWebDriver,
  hostname: string,
  port: number
): WebDriverAddress {
  const { pathPrefix, ssl, username, accessKey } = configured
  const secure = ssl === undefined ? port === 443 : Boolean(ssl)
  const hasCredentials = Boolean(username) && accessKey !== undefined
  return {
    hostname,
    port,
    protocol: secure ? 'https' : 'http',
    path: typeof pathPrefix === 'string' ? pathPrefix : undefined,
    ...(hasCredentials
      ? { user: String(username), key: String(accessKey) }
      : {}),
    onWarn: (message: string) => log.warn(message)
  }
}

/**
 * Walks Nightwatch's internal config (transport / queue.transport /
 * nightwatchInstance, none of which are on the public NightwatchBrowser type)
 * to find the underlying WebDriver host+port.
 */
export function resolveWebDriverAddress(browser: NightwatchBrowser): {
  driverHost: string
  driverPort: number
} {
  const { host, port } = configuredWebDriver(browser)
  return {
    driverHost: String(host || 'localhost'),
    driverPort: Number(port || 9515)
  }
}

/** The core transport's address: the connection Nightwatch itself uses, plus this adapter's logger. */
function address(browser: NightwatchBrowser): WebDriverAddress {
  const { driverHost, driverPort } = resolveWebDriverAddress(browser)
  return connection(configuredWebDriver(browser), driverHost, driverPort)
}

function sessionId(browser: NightwatchBrowser): string | undefined {
  return (browser as unknown as { sessionId?: string }).sessionId
}

/** GET `/session/:id/<path>`. Null when the session is gone or the call fails. */
export function webdriverGet<T>(
  browser: NightwatchBrowser,
  path: string
): Promise<T | null> {
  const id = sessionId(browser)
  return id ? coreGet<T>(address(browser), id, path) : Promise.resolve(null)
}

/** POST `/session/:id/<path>`. Null when the session is gone or the call fails. */
export function webdriverPost<T>(
  browser: NightwatchBrowser,
  path: string,
  body: unknown
): Promise<T | null> {
  const id = sessionId(browser)
  return id
    ? corePost<T>(address(browser), id, path, body)
    : Promise.resolve(null)
}

/** Appium execute methods for the session current now: a listener belongs to one session, so a later read never reaches its replacement. */
export function sessionExecutor(
  browser: NightwatchBrowser
): InterceptorExecute | undefined {
  const id = sessionId(browser)
  const configured = configuredWebDriver(browser)
  // No default port here: guessing chromedriver's would blame a missing plugin for a wrong address.
  if (!id || !configured.port) {
    return undefined
  }
  const at = connection(
    configured,
    String(configured.host || 'localhost'),
    Number(configured.port)
  )
  return (script, args) => coreExecute(at, id, script, args)
}

/** Run a script in the page, outside the command queue. `body` is a function
 *  body, matching what `browser.execute` accepts. */
export function webdriverExecute<T>(
  browser: NightwatchBrowser,
  body: string
): Promise<T | null> {
  return webdriverPost<T>(browser, 'execute/sync', { script: body, args: [] })
}
