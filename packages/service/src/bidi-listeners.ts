import logger from '@wdio/logger'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/devtools-service:bidi-listeners')

/**
 * Subscribe a SessionCapturer to the BiDi event stream coming off a
 * WebdriverIO browser — network request lifecycle (3 events) + browser
 * console (`log.entryAdded`). Idempotent only in the sense that the caller
 * should gate it (e.g. with a one-shot flag); this function will register a
 * fresh listener on each call.
 *
 * Returns nothing. Errors during the optional `sessionSubscribe(log)` call
 * are logged but non-fatal — WDIO auto-subscribes to network events; only
 * log events need the explicit subscribe.
 */
export function attachBidiListeners(
  browser: WebdriverIO.Browser,
  capturer: SessionCapturer
): void {
  log.info('Setting up BiDi network event listeners...')

  browser.on('network.beforeRequestSent', (event: any) => {
    capturer.handleNetworkRequestStarted(event)
  })
  browser.on('network.responseCompleted', (event: any) => {
    capturer.handleNetworkResponseCompleted(event)
  })
  browser.on('network.fetchError', (event: any) => {
    log.info(`>>> BiDi fetchError - keys: ${Object.keys(event).join(', ')}`)
    capturer.handleNetworkFetchError(event)
  })
  browser.on('log.entryAdded', (event: any) => {
    capturer.handleLogEntryAdded(event)
  })

  // WDIO auto-subscribes to network events but not log events.
  try {
    ;(browser as any).sessionSubscribe?.({ events: ['log.entryAdded'] })
  } catch (err) {
    log.warn(
      `Could not subscribe to log.entryAdded: ${(err as Error).message}`
    )
  }

  log.info('✓ BiDi network + log event listeners registered')
}
