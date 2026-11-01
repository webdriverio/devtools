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
