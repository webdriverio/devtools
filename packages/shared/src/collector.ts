// HTTP contract for the page-side collector bundle.
//
// The collector (`@wdio/devtools-script`) is the runtime an adapter injects
// into the page to capture DOM mutations. Adapters used to locate it on disk,
// which only works inside a monorepo checkout — a published install has no
// `packages/script/dist/script.js` to walk up to, so DOM replay silently went
// missing while every other capability kept working.
//
// The backend already depends on the collector's package and is the one thing
// every adapter is connected to, so it serves the bundle instead. That makes
// the version matched by construction rather than pinned in each language, and
// a new adapter needs an HTTP GET rather than its own copy of the file.

/** Endpoint the backend serves the page-side collector source from. */
export const COLLECTOR_API = {
  get: '/api/collector'
} as const

/** `Content-Type` the collector is served with. It is JavaScript source that a
 *  caller injects into the page, never a module the browser loads itself. */
export const COLLECTOR_CONTENT_TYPE = 'application/javascript; charset=utf-8'

/**
 * Window property a BiDi preload writes its emit function to, so the collector
 * can PUSH mutations instead of waiting to be drained.
 *
 * It has to be a global rather than an argument: the preload receives the
 * channel as a parameter, but the collector installs its MutationObserver and
 * anchors the document from its own module body, which runs before the preload
 * wrapper's body finishes. Writing the function here first is what lets the
 * collector pick it up before it captures anything, so the document anchor —
 * the largest and earliest payload — goes out through the channel too.
 *
 * Named here rather than in each writer because three of them exist: core's
 * preload wrapper, the collector that reads it, and the Python adapter (via its
 * generated `_contract.py`).
 */
export const COLLECTOR_SINK_GLOBAL = '__wdioTraceSink'

/** BiDi channel the collector's pushed mutations arrive on. A session's other
 *  subscribers see every `script.message`, so a receiver must match on this. */
export const COLLECTOR_MUTATION_CHANNEL = 'wdio-trace-mutations'
