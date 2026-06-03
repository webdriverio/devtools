import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
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

  // WDIO's BiDi event types are a broader union than our handlers'
  // narrower expected shape. The handlers do their own runtime narrowing;
  // the cast at this seam is intentional and isolated.
  type BidiRequestSent = Parameters<
    typeof capturer.handleNetworkRequestStarted
  >[0]
  type BidiResponseCompleted = Parameters<
    typeof capturer.handleNetworkResponseCompleted
  >[0]
  type BidiFetchError = Parameters<typeof capturer.handleNetworkFetchError>[0]
  type BidiLogEntry = Parameters<typeof capturer.handleLogEntryAdded>[0]

  browser.on('network.beforeRequestSent', (event) => {
    capturer.handleNetworkRequestStarted(event as unknown as BidiRequestSent)
  })
  browser.on('network.responseCompleted', (event) => {
    capturer.handleNetworkResponseCompleted(
      event as unknown as BidiResponseCompleted
    )
  })
  browser.on('network.fetchError', (event) => {
    log.info(
      `>>> BiDi fetchError - keys: ${Object.keys(event as object).join(', ')}`
    )
    capturer.handleNetworkFetchError(event as unknown as BidiFetchError)
  })
  browser.on('log.entryAdded', (event) => {
    capturer.handleLogEntryAdded(event as unknown as BidiLogEntry)
  })

  // WDIO auto-subscribes to network events but not log events.
  try {
    // sessionSubscribe is augmented onto WebdriverIO.Browser in types.ts.
    browser.sessionSubscribe?.({ events: ['log.entryAdded'] })
  } catch (err) {
    log.warn(`Could not subscribe to log.entryAdded: ${errorMessage(err)}`)
  }

  log.info('✓ BiDi network + log event listeners registered')
}
