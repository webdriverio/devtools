import { COLLECTOR_SINK_GLOBAL } from '@wdio/devtools-shared'
import { getLogs, clearLogs } from './logger.js'
import { ConsoleLogCollector } from './collectors/consoleLogs.js'
import { NetworkRequestCollector } from './collectors/networkRequests.js'
import { assignRef, hasRef, parseDocument } from './utils.js'

/**
 * When THIS document came into existence, as epoch ms.
 *
 * The anchor must not be stamped with the drain's clock. A drain is forced from
 * Node whenever a collector might be fresh, which is always some time after the
 * navigation that created the document — a round trip at best, a whole page load
 * at worst — and several actions can run inside that gap. Stamped at drain time
 * the anchor lands after them, so they all replay the PREVIOUS page's DOM.
 *
 * `performance.timeOrigin` is this document's navigation start, which is exactly
 * the moment the anchor describes and is immune to which drain happens to
 * collect it. Falls back to the drain clock where it isn't exposed.
 */
function documentAnchorTime(): number {
  const origin = performance?.timeOrigin
  return typeof origin === 'number' && Number.isFinite(origin) && origin > 0
    ? Math.round(origin)
    : Date.now()
}

export class DataCollector {
  #metadata = {
    url: window.location.href,
    // Serialize viewport values explicitly — VisualViewport properties are
    // prototype getters and won't survive JSON.stringify otherwise.
    viewport: {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
      offsetLeft: window.visualViewport?.offsetLeft ?? 0,
      offsetTop: window.visualViewport?.offsetTop ?? 0,
      scale: window.visualViewport?.scale ?? 1
    }
  }
  #errors: string[] = []
  #mutations: TraceMutation[] = []
  /** Whether THIS collector has emitted its full-DOM anchor. Instance-scoped on
   *  purpose: the document's refs outlive a replaced collector, so keying on
   *  them made a re-injected collector unable to anchor at all. */
  #anchored = false
  #consoleLogs = new ConsoleLogCollector()
  #networkRequests = new NetworkRequestCollector()

  /** Where mutations go when a BiDi channel is available. Undefined means the
   *  buffer is the only transport and something must come and drain it. */
  #sink: ((payload: string) => void) | undefined

  /**
   * Push mutations through `sink` instead of buffering them for a drain.
   *
   * The payload is a JSON STRING, not an object. BiDi serializes a channel's
   * argument as a RemoteValue under an object-depth limit, which would silently
   * truncate the document anchor — the one payload that is an arbitrarily deep
   * tree. A string is depth-1 and survives whole.
   *
   * Anything already buffered is flushed immediately, so a sink installed after
   * the first capture loses nothing.
   */
  setSink(sink: (payload: string) => void) {
    this.#sink = sink
    if (this.#mutations.length) {
      const buffered = this.#mutations
      this.#mutations = []
      this.#emit(buffered)
    }
  }

  /** Hand `mutations` to the sink, or put them back in the buffer if it fails.
   *  A channel dies with its session, and teardown is exactly when the last
   *  mutations arrive — dropping them there would lose the final page state. */
  #emit(mutations: TraceMutation[]) {
    try {
      this.#sink?.(JSON.stringify(mutations))
    } catch {
      this.#mutations.push(...mutations)
    }
  }

  captureError(err: Error) {
    const error = err.stack || err.message
    this.#errors.push(error)
  }

  captureMutation(mutations: TraceMutation[]) {
    if (this.#sink) {
      this.#emit(mutations)
      return
    }
    this.#mutations.push(...mutations)
  }

  /** Force a full-DOM anchor of the CURRENT document, unless it was already
   *  anchored. The initial anchor runs asynchronously (after `waitForBody`), so
   *  the destination of a closing navigation — e.g. a logout landing back on the
   *  login page as the last action — may not be anchored yet when the final
   *  drain fires at teardown. Skipped when the root already carries a ref (the
   *  async anchor won the race): re-running assignRef would renumber descendants
   *  and desync every prior mutation. */
  captureCurrentDom() {
    if (this.#anchored) {
      return
    }
    this.#anchored = true
    // Only number the tree when it isn't numbered yet. A re-injected collector
    // lands on a document a PREVIOUS collector already ref'd; re-running
    // assignRef would renumber every descendant and desync prior mutations,
    // but refusing to anchor at all loses the document entirely — which is what
    // made a navigation destination's DOM vanish from the trace.
    if (!hasRef(document.documentElement)) {
      assignRef(document.documentElement)
    }
    this.captureMutation([
      {
        type: 'childList',
        url: window.location.href,
        timestamp: documentAnchorTime(),
        addedNodes: [parseDocument(document.documentElement)],
        removedNodes: []
      }
    ])
  }

  reset() {
    this.#errors = []
    this.#mutations = []
    // `#anchored` deliberately survives a reset so a later drain doesn't
    // re-emit the whole document.
    this.#consoleLogs.clear()
    this.#networkRequests.clear()
    clearLogs()
  }

  getMetadata() {
    return this.#metadata
  }

  getTraceData() {
    const data = {
      errors: this.#errors,
      mutations: this.#mutations,
      consoleLogs: this.#consoleLogs.getArtifacts(),
      networkRequests: this.#networkRequests.getArtifacts(),
      traceLogs: getLogs(),
      metadata: this.getMetadata()
    } as const
    this.reset()
    return data
  }
}

export type DataCollectorType = DataCollector
export const collector = (window.wdioTraceCollector = new DataCollector())

// Claim the channel a BiDi preload left here, before anything is captured. This
// runs in the collector's own module body, which the bundle evaluates ahead of
// the observer setup and the document anchor — so with a preload in place every
// mutation this session produces is pushed, and nothing waits for a drain.
const pendingSink = (window as unknown as Record<string, unknown>)[
  COLLECTOR_SINK_GLOBAL
]
if (typeof pendingSink === 'function') {
  collector.setSink(pendingSink as (payload: string) => void)
}
