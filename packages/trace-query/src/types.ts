import type {
  CommandLog,
  ImageMime,
  ImageSize,
  TraceActionGroupNode,
  TraceOutcome
} from '@wdio/devtools-shared'
import type { ACTION_STATUS, TRACE_ERROR_KIND } from './constants.js'

declare const traceHandleBrand: unique symbol

/** An opened trace. Every query takes one; what it holds is not part of the API. */
export interface TraceHandle {
  readonly [traceHandleBrand]: true
}

export interface PageRequest {
  /** Where the previous page of the same query stopped, as it returned in `nextCursor`. */
  cursor?: string
  maxChars?: number
}

export interface PageOptions<T> {
  /** What the listing is, such as its query's filters; a cursor from a listing with another scope is refused. */
  scope?: string
  /** An item's cost against the budget; its serialized length unless named. */
  size?: (item: T) => number
}

export interface Page<T> {
  items: T[]
  /** Items in the whole result, across every page. */
  total: number
  /** Present while items remain; pass it back as `cursor` to the same query for the next page. */
  nextCursor?: string
}

export interface TruncatedText {
  text: string
  /** Characters in the text before it was cut. */
  totalChars: number
  truncated: boolean
}

export interface OpenTraceOptions {
  /** Directories a local path must resolve inside, after symlinks; none means local paths are refused. */
  allowedRoots?: readonly string[]
  /** Hosts a URL may be fetched from: an exact name, or `*.example.com` for its subdomains; none means URLs are refused. */
  allowedHosts?: readonly string[]
  /** Fetch from loopback, private and link-local addresses too. */
  allowPrivateNetwork?: boolean
  /** Largest zip read, in bytes. */
  maxZipBytes?: number
  /** Most the entries a trace's payload is built from may declare inflating to, in bytes. */
  maxInflatedBytes?: number
}

/** Which test to open, as a span or a manifest names it; uid and spec file together, since tests with the same title share a uid. */
export interface TraceTarget {
  uid: string
  specFile?: string
  /** The final attempt unless named. */
  attempt?: number
  /** The session the test ran in, when one uid and spec file ran in several (the same test on two browsers). */
  sessionId?: string
}

/** The test a trace was opened for, as its artifacts manifest records it. */
export interface TraceSelection {
  uid: string
  title: string
  specFile: string
  attempt: number
  state?: string
  /** The zip also holds other tests or earlier attempts, and the queries read all of it. */
  sharedZip: boolean
}

export interface OpenedTrace {
  handle: TraceHandle
  /** The zip opened: a real path, or the URL without its query string. */
  source: string
  test?: TraceSelection
}

export interface HttpResponse {
  status: number
  location?: string
  contentLength?: number
  body: AsyncIterable<Uint8Array>
  discard(): void
}

/** One GET of a URL, without following redirects; injectable so tests need no server. */
export type HttpGet = (url: URL, signal: AbortSignal) => Promise<HttpResponse>

/** How an action ended: `failed` by shared's rule, or `retried`, a failed poll that the wait which issued it went on to pass. */
export type ActionStatus = (typeof ACTION_STATUS)[keyof typeof ACTION_STATUS]

/** One action in the trace's order. */
export interface ActionRow {
  /** The action's id in the trace, which `traceActionDetail` takes and the player's links name. */
  callId: string
  title: string
  /** Ms from the trace's start. */
  startMs: number
  durationMs: number
  /** Absent when the action passed. */
  status?: Exclude<ActionStatus, 'passed'>
  /** Why it failed, or what a retried poll raised; cut to a list's length. */
  error?: string
  /** The rows it issued, such as a wait's polls, the first of them when it issued many. */
  children?: ActionRow[]
  /** Rows it issued that `children` leaves out. */
  omittedChildren?: number
}

export interface ActionQuery extends PageRequest {
  /** `passed` keeps a row that passed itself; `failed` and `retried` keep a row when it or a row it issued has that status. */
  status?: ActionStatus
  /** The `callId` of a suite, test or step from the summary's `tests`. */
  group?: string
  /** Keeps rows that ran at least partly inside the window, in ms from the trace's start. */
  fromMs?: number
  toMs?: number
}

export type TraceErrorKind =
  (typeof TRACE_ERROR_KIND)[keyof typeof TRACE_ERROR_KIND]

/** A failed action, a step that failed on its own, a console error or a failed request. */
export interface TraceError {
  kind: TraceErrorKind
  /** Ms from the trace's start at which the action or step started, the line was written or the request was issued. */
  timeMs: number
  /** The failed action or step itself, or for a console line or request the action last started before it; absent before the first action. */
  callId?: string
  /** The failed action's or step's title. */
  title?: string
  message: string
  method?: string
  url?: string
  status?: number
}

/** A suite, test or step the trace records, with its outcome read from its rows. */
export interface TestNode {
  /** Passed to `traceActions` as `group` to list its actions. */
  callId: string
  title: string
  outcome: TraceOutcome
  children?: TestNode[]
}

export interface TraceSummary {
  runner?: string
  browser?: string
  device?: string
  /** Ms from the first event the trace recorded to the last. */
  durationMs: number
  outcome: TraceOutcome
  /** Each count is of the items `traceErrors` and `traceActions` list: top-level actions, not the rows they issued. */
  counts: {
    actions: number
    failedActions: number
    failedSteps: number
    consoleErrors: number
    failedRequests: number
  }
  /** The first failed action, else the first step that failed on its own; in a trace that did not fail, the first console error or failed request. */
  firstError?: TraceError
  tests?: TestNode[]
  /** Suites, tests and steps left out of `tests` to keep the summary within its budget. */
  omittedTests?: number
}

/** One action in full; long values are cut, saying so. */
export interface ActionDetail {
  callId: string
  title: string
  command: string
  /** Ms from the trace's start. */
  startMs: number
  durationMs: number
  status?: Exclude<ActionStatus, 'passed'>
  /** The suites and test it ran in, outermost first. */
  test?: string[]
  /** The action that issued it, such as a wait. */
  parent?: string
  /** The actions it issued, the first of them when it issued many. */
  children?: string[]
  /** Actions it issued that `children` leaves out. */
  omittedChildren?: number
  selector?: string
  args?: string
  result?: string
  error?: ActionError
  /** Where the test issued it, as `file:line`. */
  callSite?: string
  /** The lines around the call site, numbered, with `>` on the call's own line. */
  source?: string[]
}

/** The zip keeps an error's message, not its stack; `callSite` and `source` say where the test was. */
export interface ActionError {
  message: string
  /** A failed assertion's expected and actual values, as JSON. */
  expected?: string
  actual?: string
}

export interface ActionDetailOptions {
  /** Source lines on each side of the call site. */
  contextLines?: number
  /** Characters the whole result may take; fields and source lines are cut until it fits. */
  maxChars?: number
}

/** A row of `trace.commands` with its id and clock, in ms from the trace's start. */
export interface OrderedAction {
  command: CommandLog
  /** Its position in `trace.commands`, which the action tree's `commandIndex` names. */
  index: number
  callId: string
  startMs: number
  endMs: number
}

/** A top-level row with the rows it issued, and how each ended. */
export interface ActionNode {
  action: OrderedAction
  status: ActionStatus
  children: ActionNode[]
}

/** A step whose own end carried an error message. */
export type FailedStep = TraceActionGroupNode & { error: string }

/** How far one attempt at an action's detail cuts: each field's characters, and source lines on each side. */
export interface DetailCut {
  text: number
  /** Source lines on each side of the call site, or none at all, the call's own line included. */
  contextLines: number | 'none'
}

/** What an action's detail holds whatever it is cut to, read once per detail. */
export interface DetailBasis {
  action: OrderedAction
  status: ActionStatus
  /** Titles of the steps it ran in, outermost first, before cutting. */
  test: string[]
  relatives: Pick<ActionDetail, 'parent' | 'children' | 'omittedChildren'>
}

/** A console line's level; a terminal line written to stderr reads as `error`. */
export type ConsoleLevel = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'

/** Where a console line came from: the page's console, the test's own output, or the runner's terminal. */
export type ConsoleSource = 'browser' | 'test' | 'terminal'

/** How a request ended. `unknown` is a Resource Timing row whose browser exposed no status: it completed, and is never `error`. `error` with status 0 is a transport failure, or, with no `statusText`, possibly a request that had not answered when the trace was written. */
export type RequestStatusKind =
  'ok' | 'redirect' | 'error' | 'pending' | 'unknown'

/** What the capture classified a request as. */
export type RequestType =
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'fetch'
  | 'xhr'
  | 'other'

/** A request seen only through the page's Resource Timing buffer, which exposes no headers or body. */
export type NetworkSource = 'resource-timing'

/** Absolute wall-clock bounds a listing keeps, inclusive. */
export interface TimeRange {
  from: number
  to: number
}

/** Which of a request's header maps a header is in. */
export type HeaderField = 'requestHeaders' | 'responseHeaders'

/** Narrows a listing to the time around one action. */
export interface ActionWindow {
  /** The action's `callId`. */
  action?: string
  /** Milliseconds before the action started and after it ended; only with `action`. */
  windowMs?: number
}

export interface ConsoleQuery extends PageRequest, ActionWindow {
  /** Absent: `['error']`. Empty: every level. */
  levels?: ConsoleLevel[]
  /** Empty or absent: every source. */
  sources?: ConsoleSource[]
  /** Case-insensitive substring of the line's text. */
  text?: string
  /** Characters a line may take, the note of a cut included. */
  maxLineChars?: number
}

export interface ConsoleLine {
  /** Milliseconds after the trace started. */
  timeMs: number
  level: ConsoleLevel
  /** Absent when the zip names none, or one outside the vocabulary. */
  source?: ConsoleSource
  /** Cut past `maxLineChars`, ending in a note of its whole length. */
  text: string
}

export interface ConsolePage extends Page<ConsoleLine> {
  /** Lines per level among those the other filters match, whatever `levels` asks for, so the levels a default listing leaves out are still counted. */
  byLevel: Partial<Record<ConsoleLevel, number>>
}

export interface NetworkQuery extends PageRequest, ActionWindow {
  /** Empty or absent: every status kind. */
  status?: RequestStatusKind[]
  /** Case-insensitive substring of the full URL. */
  url?: string
}

export interface NetworkRow {
  /** What `traceNetworkRequest` takes. */
  id: string
  /** When the request started, in milliseconds after the trace started. */
  startMs: number
  durationMs?: number
  method?: string
  status?: number
  statusKind: RequestStatusKind
  /** Only for a request that failed, where it can carry the browser's reason; status 0 without it may be a request that had not answered when the trace was written. */
  statusText?: string
  type: RequestType
  /** Without the origin when it is the page's main origin (`NetworkPage.origin`); a long one is cut, ending in a note of its whole length. */
  url: string
  source?: NetworkSource
}

export interface NetworkPage extends Page<NetworkRow> {
  /** The origin a row's URL leaves out when it starts with `/`. */
  origin?: string
  /** Requests per status kind among those the other filters match, whatever `status` asks for. */
  byStatus: Partial<Record<RequestStatusKind, number>>
}

export interface TraceNetworkRequestOptions {
  /** Characters the whole result may take: the request's own fields first, then its headers while they fit, then its body. */
  maxChars?: number
  /** Read the response body; it stays in the zip otherwise. */
  body?: boolean
  /** Characters the body may take, the note of a cut included; the default result budget unless given. */
  maxBodyChars?: number
}

export interface TraceNetworkRequestDetail extends NetworkRow {
  /** The URL with its origin; past 2000 characters it is cut, ending in a note of its whole length. */
  url: string
  mimeType?: string
  size?: number
  /** Measured phase durations in milliseconds, by HAR phase name; absent when the capture measured none. */
  timingsMs?: Record<string, number>
  /** Each value past 2000 characters, or past what the budget leaves, is cut, ending in a note of its whole length. */
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  /** Headers left out because the rest of the result took the budget. */
  omittedHeaders?: number
  /** What the capture could not see, for a source that exposes less. */
  note?: string
  /** Cut to what `maxChars` leaves once the headers are listed, and never past `maxBodyChars`, ending in a note of its whole length. */
  body?: string
  /** Why no body came back, when one was asked for. */
  bodyUnavailable?: string
}

/** The capture a page state was read from, and the action it belongs to. */
export interface CaptureSource {
  /** When the capture was stamped, in ms from the trace start. */
  timeMs: number
  /** The action the capture was taken for; absent for a screencast frame, which is recorded on a timer rather than for an action. */
  callId?: string
  title?: string
  /** False when the asked action took no capture of its own and shows the latest earlier one, as the player does. */
  own: boolean
}

/** Narrows a snapshot to the subtrees of the nodes that match; when both are named, a node matches both. */
export interface SnapshotScope {
  /** A node's captured locator, exactly as the snapshot writes it after `→`. */
  locator?: string
  /** Text a node's role, name or purpose contains, ignoring case. */
  text?: string
}

export interface TraceSnapshotRequest extends PageRequest, SnapshotScope {}

/** The accessibility tree at an action: one page of its node lines, each indented two spaces per depth from the shallowest line of the result, an element's ending `→ <locator>`. */
export interface TraceSnapshot extends Page<string> {
  /** The action asked about. */
  callId: string
  capture: CaptureSource
  /** The `[Page: ...]` line naming a web page's title and url, or `[android]` / `[ios]` for a native app. */
  header?: string
  /** Subtrees the scope matched; present only when scoped. */
  matches?: number
}

export interface TraceScreenshotRequest {
  /** Longest side, in pixels, of the size `fit` names; the image is never fitted larger than it is. */
  maxEdge?: number
}

/** Where a screenshot at an action came from, whether or not its image could be read. */
interface ScreenshotAt {
  /** The action asked about. */
  callId: string
  capture: CaptureSource
}

/** The screenshot at an action, as the trace stores it, with the size to downscale it to before a model sees it. */
export interface ScreenshotImage extends ScreenshotAt {
  mimeType: ImageMime
  bytes: Uint8Array
  /** The stored image's pixel size. */
  size: ImageSize
  /** The size within `maxEdge` with the image's aspect ratio. */
  fit: ImageSize
  /** Roughly what Claude's API bills for the image at `fit`. */
  tokens: number
}

/** A screenshot the trace names for an action but whose image did not come back. */
export interface ScreenshotUnavailable extends ScreenshotAt {
  /** Why: no declared size, over the read limit, unreadable, or not a PNG or JPEG. */
  unavailable: string
}

export type TraceScreenshot = ScreenshotImage | ScreenshotUnavailable
