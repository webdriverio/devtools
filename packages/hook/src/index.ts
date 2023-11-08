/// <reference types="../../script/types.d.ts" />

import type { Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { SessionCapturer } from './session.js'

export function setupForDevtools (opts: Options.WebdriverIO) {
  const session = new SessionCapturer()

  /**
   * make sure to run with Bidi enabled by setting `webSocketUrl` to `true`
   */
  const w3cCaps = opts.capabilities as Capabilities.W3CCapabilities
  const multiRemoteCaps = opts.capabilities as Capabilities.MultiRemoteCapabilities
  const caps = w3cCaps.alwaysMatch
    ? w3cCaps.alwaysMatch
    : multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities
      ? multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities as WebdriverIO.Capabilities
      : opts.capabilities as WebdriverIO.Capabilities
  caps.webSocketUrl = true

  /**
   * register before command hook
   */
  opts.beforeCommand = Array.isArray(opts.beforeCommand)
    ? opts.beforeCommand
    : opts.beforeCommand ? [opts.beforeCommand] : []
  opts.beforeCommand.push(async function (this: WebdriverIO.Browser, command: keyof WebDriverCommands) {
    return session.beforeCommand(this, command)
  })

  /**
   * register after command hook
   */
  opts.afterCommand = Array.isArray(opts.afterCommand)
    ? opts.afterCommand
    : opts.afterCommand ? [opts.afterCommand] : []
  opts.afterCommand.push(session.afterCommand.bind(session))

  /**
   * return modified session configuration
   */
  return opts
}
