import { getLogs, clearLogs } from './logger.js'
import { ConsoleLogCollector } from './collectors/consoleLogs.js'
import { NetworkRequestCollector } from './collectors/networkRequests.js'
import { ResourceTimingCollector } from './collectors/resourceTiming.js'
import { assignRef, hasRef, parseDocument } from './utils.js'
import { pageMask } from './masking.js'
import type { ConsoleLogs } from './collectors/consoleLogs.js'
import type { NetworkRequest } from '../types.js'

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

/** Typed values are scrubbed at the drain, once per batch, so a keystroke costs a map write and nothing more. */
function scrubRequestBodies(requests: NetworkRequest[]): NetworkRequest[] {
  for (const request of requests) {
    if (request.requestBody) {
      request.requestBody = pageMask.scrub(request.requestBody)
    }
    if (request.responseBody) {
      request.responseBody = pageMask.scrub(request.responseBody)
    }
  }
  return requests
}

function scrubConsoleLogs(logs: ConsoleLogs[]): ConsoleLogs[] {
  for (const entry of logs) {
    entry.args = entry.args.map((arg) =>
      typeof arg === 'string' ? pageMask.scrub(arg) : arg
    )
  }
  return logs
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
  /** The document's own record of every load, which is the only network
   *  source a browser without BiDi has. Given the patch's claims so a fetch
   *  both of them saw is reported once, with the patch's headers and body. */
  #resourceTiming = new ResourceTimingCollector((url, startTime, entry) =>
    this.#networkRequests.consumeClaim(url, startTime, entry)
  )

  captureError(err: Error) {
    const error = err.stack || err.message
    this.#errors.push(error)
  }

  captureMutation(mutations: TraceMutation[]) {
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
    this.#resourceTiming.clear()
    clearLogs()
  }

  getMetadata() {
    return this.#metadata
  }

  /** The mask selector list, read by the element scripts so an action snapshot masks what the DOM stream masks. */
  maskSelector(): string | null {
    return pageMask.selector
  }

  /** Where the element scripts mask a name or locator drawn from typed text. */
  typingSurfaceSelector(): string | null {
    return pageMask.typingSurfaceSelector()
  }

  getTraceData() {
    const data = {
      errors: this.#errors,
      mutations: this.#mutations,
      consoleLogs: scrubConsoleLogs(this.#consoleLogs.getArtifacts()),
      networkRequests: scrubRequestBodies([
        ...this.#networkRequests.getArtifacts(),
        ...this.#resourceTiming.getArtifacts()
      ]).sort((a, b) => a.startTime - b.startTime),
      traceLogs: getLogs(),
      metadata: this.getMetadata()
    } as const
    this.reset()
    return data
  }
}

export type DataCollectorType = DataCollector

const installed = window.wdioTraceCollector
// Two injections racing past one presence probe must not replace the collector.
export const alreadyInstalled = installed !== undefined
export const collector =
  installed ?? (window.wdioTraceCollector = new DataCollector())
