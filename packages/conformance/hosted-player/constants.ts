/** Where `vite preview` serves the hosted build, as `pnpm player:hosted` does. */
export const HOSTED_PREVIEW_PORT = 4173
export const HOSTED_PREVIEW_HOST = '127.0.0.1'

/** The landing screen's heading, the one text that says the hosted build booted. */
export const LANDING_HEADING = 'WebdriverIO Trace Viewer'

/** The file the check opens to see the landing screen refuse a non-zip. */
export const NOT_A_TRACE_NAME = 'not-a-trace.txt'
export const NOT_A_TRACE_ERROR = `Could not open ${NOT_A_TRACE_NAME}:`

/** The parse worker's emitted script; Vite names it after its entry plus a content hash. */
export const WORKER_SCRIPT_RE =
  /\/assets\/trace-parse\.worker-[\w-]+\.js(?:[?#]|$)/

/** Prefixed to the console error the page reports each CSP violation as. */
export const CSP_VIOLATION_PREFIX = '[csp-violation]'

/** Directives the hosted page has to send for the check to mean anything. */
export const REQUIRED_CSP_DIRECTIVES: readonly string[] = [
  "script-src 'self'",
  "connect-src 'self'"
]

/** A fixture zip is a few hundred KB, so anything slower than this is a hang, not a slow parse. */
export const OPEN_TIMEOUT_MS = 30_000
export const LANDING_TIMEOUT_MS = 30_000

/** Expanding the action tree reveals one level per pass; no committed trace nests deeper. */
export const MAX_EXPAND_PASSES = 10
