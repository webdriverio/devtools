/**
 * Nightwatch eventHub integration.
 *
 * Extracted from the plugin class so registration stays out of the
 * file-size cap and the metadata-forwarding behavior is unit-testable
 * without standing up the whole plugin. The plugin's
 * `registerEventHandlers(eventHub)` delegates here.
 */

import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { TraceType } from './types.js'
import type { SessionCapturer } from './session.js'
import type { NightwatchEventHub } from './types.js'

const log = logger('@wdio/nightwatch-devtools:event-hub')

export interface EventHubBindings {
  /** Live session capturer — may be undefined until bringup completes. */
  getSessionCapturer(): SessionCapturer | undefined
  /** Builds the `options` field forwarded with the metadata payload. */
  buildMetadataOptions(): unknown
  /** Lets the plugin flip the cucumber-runner flag on detection. */
  setCucumberRunner(value: boolean): void
}

function makeSessionMetadataHandler(
  bindings: EventHubBindings
): (data: unknown) => void {
  return (data: unknown) => {
    try {
      const md =
        ((data as { metadata?: Record<string, unknown> } | undefined)
          ?.metadata as Record<string, unknown> | undefined) ?? {}
      const capturer = bindings.getSessionCapturer()
      const sessionCapabilities = md.sessionCapabilities
      const sessionId = md.sessionId as string | undefined
      if (!capturer || (!sessionCapabilities && !sessionId)) {
        return
      }
      capturer.sendUpstream('metadata', {
        type: TraceType.Testrunner,
        capabilities: sessionCapabilities ?? {},
        sessionId,
        testEnv: md.testEnv as string | undefined,
        host: md.host as string | undefined,
        modulePath: md.modulePath as string | undefined,
        options: bindings.buildMetadataOptions()
      })
    } catch (err) {
      log.error(`Error in event handler: ${errorMessage(err)}`)
    }
  }
}

export function registerEventHandlers(
  eventHub: NightwatchEventHub,
  bindings: EventHubBindings
): void {
  bindings.setCucumberRunner(eventHub.runner === 'cucumber')
  if (eventHub.runner === 'cucumber') {
    log.info('✓ Cucumber runner detected via NightwatchEventHub')
  }
  log.info('✓ NightwatchEventHub registered — enriched metadata enabled')
  const handler = makeSessionMetadataHandler(bindings)
  eventHub.on('TestSuiteStarted', handler)
  eventHub.on('TestRunStarted', handler)
}
