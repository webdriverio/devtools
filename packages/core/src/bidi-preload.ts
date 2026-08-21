// Document-start injection of the collector via a BiDi preload script.
//
// The `<script>`-append injection in `script-loader.ts` only ever instruments
// the document that is loaded at the time it runs, and a `<script>` dies with
// its document. So a navigation always produces a document we learn about
// afterwards, and everything built on that — when to re-inject, when to drain,
// which action to credit the new DOM to — is reconstruction, and races. A
// preload script registered globally runs in EVERY document before any of its
// script does, so each one instruments itself and anchors its own DOM at its own
// `performance.timeOrigin`. Nothing to detect, nothing to attribute.

import {
  COLLECTOR_MUTATION_CHANNEL,
  COLLECTOR_SINK_GLOBAL,
  type TraceMutation
} from '@wdio/devtools-shared'
import { loadSeleniumSubmodule } from './bidi.js'
import { errorMessage } from './error.js'
import { loadCollectorSource } from './script-loader.js'

interface ScriptManager {
  addPreloadScript: (
    functionDeclaration: string,
    argumentValueList?: unknown[],
    sandbox?: string | null
  ) => Promise<number>
  onMessage: (callback: (message: BidiScriptMessage) => void) => Promise<void>
}

/** `script.message`, as selenium-webdriver hands it over: the channel name plus
 *  the emitted argument wrapped in a RemoteValue. */
interface BidiScriptMessage {
  channel?: string
  data?: { value?: unknown }
}

/** The two classes `addPreloadScript` needs to describe a channel argument. It
 *  calls `.asMap()` on every element of the list, so a plain object is not
 *  interchangeable with a `LocalValue` here. */
interface ProtocolValueModule {
  LocalValue: { createChannelValue: (channel: unknown) => unknown }
  ChannelValue: new (channel: string) => unknown
}

/** `selenium-webdriver/bidi/scriptManager`'s default export. Cast at this
 *  boundary — the module ships no types. */
type ScriptManagerFactory = (
  browsingContextIds: unknown,
  driver: unknown
) => Promise<ScriptManager>

/**
 * Subscribe to the collector's pushed mutations and return the channel argument
 * the preload registration needs, or undefined when the channel can't be built.
 *
 * Undefined rather than a throw, so a session that cannot push still gets a
 * document-start preload and falls back to being drained. Losing the push is a
 * cost; losing the preload would reintroduce the whole race class it exists to
 * remove.
 */
async function subscribeMutationChannel(
  manager: ScriptManager,
  onMutations: (mutations: TraceMutation[]) => void,
  log?: (level: 'info' | 'warn', message: string) => void
): Promise<unknown> {
  const values =
    loadSeleniumSubmodule<ProtocolValueModule>('bidi/protocolValue')
  if (!values?.LocalValue || !values?.ChannelValue) {
    log?.(
      'warn',
      'BiDi channel unavailable — mutations will be drained instead'
    )
    return undefined
  }
  try {
    await manager.onMessage((message) => {
      // Every subscriber on this session sees every script.message, so the
      // channel name is what makes this ours.
      if (message?.channel !== COLLECTOR_MUTATION_CHANNEL) {
        return
      }
      const payload = message.data?.value
      if (typeof payload !== 'string') {
        return
      }
      try {
        const parsed: unknown = JSON.parse(payload)
        if (Array.isArray(parsed) && parsed.length) {
          // The one cast for this path: the page serialized its own
          // TraceMutation[], and JSON.parse cannot know that. Narrowed here so
          // every adapter receives a typed batch instead of repeating the cast.
          onMutations(parsed as TraceMutation[])
        }
      } catch (err) {
        log?.('warn', `unparseable mutation payload: ${errorMessage(err)}`)
      }
    })
    return values.LocalValue.createChannelValue(
      new values.ChannelValue(COLLECTOR_MUTATION_CHANNEL)
    )
  } catch (err) {
    log?.(
      'warn',
      `could not subscribe to pushed mutations, falling back to draining: ${errorMessage(err)}`
    )
    return undefined
  }
}

/**
 * Register the collector to run at document-start in every document of this
 * session. Returns false when BiDi isn't available, so the caller can fall back
 * to per-document `<script>` injection.
 *
 * Requires the session to have been created with `webSocketUrl: true`; the
 * script manager throws without it.
 *
 * Passing `onMutations` also opens a channel the page pushes its mutations down,
 * which is what lets a caller stop draining once per command. Omitting it keeps
 * the pull behaviour exactly as it was, and a channel that cannot be opened
 * degrades to the same — so the drain has to stay wired either way.
 */
export async function registerCollectorPreload(
  driver: unknown,
  log?: (level: 'info' | 'warn', message: string) => void,
  onMutations?: (mutations: TraceMutation[]) => void
): Promise<boolean> {
  const factory =
    loadSeleniumSubmodule<ScriptManagerFactory>('bidi/scriptManager')
  if (!factory) {
    return false
  }
  try {
    // No browsing-context id, which registers the script GLOBALLY — contexts
    // created later are covered too. Scoping it to the current context would
    // miss exactly the documents this exists to catch.
    const manager = await factory(undefined, driver)
    const channel = onMutations
      ? await subscribeMutationChannel(manager, onMutations, log)
      : undefined
    // Raw source, not the IIFE-wrapped form: a preload script is a function
    // declaration, so the bundle's top-level await works in the body directly.
    // With a channel, the emit function is parked on a global BEFORE the source
    // runs, so the collector claims it in its own module body — see
    // COLLECTOR_SINK_GLOBAL for why an argument alone would arrive too late.
    const source = await loadCollectorSource()
    await manager.addPreloadScript(
      channel
        ? `async (emit) => { window[${JSON.stringify(COLLECTOR_SINK_GLOBAL)}] = emit; ${source} }`
        : `async () => { ${source} }`,
      channel ? [channel] : []
    )
    log?.(
      'info',
      channel
        ? '✓ Collector registered at document-start, pushing mutations (BiDi preload)'
        : '✓ Collector registered at document-start (BiDi preload)'
    )
    return true
  } catch (err) {
    log?.(
      'warn',
      `BiDi preload unavailable, falling back to per-document injection: ${errorMessage(err)}`
    )
    return false
  }
}
