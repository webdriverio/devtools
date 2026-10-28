import type {
  CommandLog,
  NetworkRequest,
  TraceMutation
} from '@wdio/devtools-shared'

import type {
  ACTION_METHODS,
  BIDI_MODES,
  CAPABILITY_TABLES,
  RESPONSIBILITIES,
  RULES
} from './constants.js'

export type BidiMode = (typeof BIDI_MODES)[number]

/** A frame as received, before any rule narrows it: an adapter may send any scope. */
export interface WireFrame {
  scope: string
  data: unknown
}

/** A document the browser created, as the fake WebDriver saw it. */
export interface BrowserDocument {
  url: string
  bornAt: number
}

/** A navigation the browser refused, with the message it answered. */
export interface FailedNavigation {
  url: string
  message: string
}

/** A document the fake browser holds, with what its page-side collector would see. */
export interface PageDocument extends BrowserDocument {
  path: string
  collector: boolean
  anchored: boolean
  buffer: TraceMutation[]
  /** The document's Resource Timing entries, as the collector reads them: every load, drained once. */
  network: NetworkRequest[]
}

/** A request the browser made while loading a document. */
export interface BrowserRequest {
  url: string
  /** The document that loaded it. */
  document: string
  at: number
}

/** What happened in the browser, independent of any adapter. */
export interface BrowserTruth {
  documents: BrowserDocument[]
  failedNavigations: FailedNavigation[]
  /** When the browser completed each user action, in order, keyed by shared's action method. */
  actions: Record<ActionMethod, number[]>
  requests: BrowserRequest[]
  /** What the session was served over BiDi, which decides what a network row must carry: `off` when no
   *  socket was handed out, whether the mode offers none or the new-session request asked for none. */
  bidi: BidiMode
}

/** The file a run's test code lives in, which every call site must name. */
export interface ScenarioFile {
  /** Every spelling of its path: as launched, and with symlinks resolved. */
  paths: string[]
  lines: number
}

/** The browser's account of a run, plus the scenario file it ran. */
export interface GroundTruth extends BrowserTruth {
  scenarioFile: ScenarioFile
}

export type ActionMethod = (typeof ACTION_METHODS)[number]

export type RuleId = (typeof RULES)[keyof typeof RULES]

/** The timeline event a violation concerns, so a report can show it in place. */
export interface ViolationSubject {
  kind: 'row' | 'anchor' | 'document' | 'request'
  timestamp: number
  /** The document, anchor or request concerned, so a gap can be scoped to it. */
  url?: string
  /** For a request: how many rows the stream lists and how many loads the browser made. */
  rows?: number
  made?: number
}

export interface Violation {
  rule: RuleId
  message: string
  /** Absent when the violation concerns the run as a whole or an event that never happened. */
  subject?: ViolationSubject
}

/** The frame stream as the rules read it: rows after every replaceCommand, anchors in time order, network rows after every re-send under an id. */
export interface RecordedStream {
  frames: WireFrame[]
  rows: CommandLog[]
  anchors: TraceMutation[]
  requests: NetworkRequest[]
}

export type AdapterId =
  | 'devtools-service'
  | 'selenium-devtools'
  | 'selenium-devtools-py'
  | 'nightwatch-devtools'

/** One user-visible action, as the dashboard would present it. */
export interface NormalizedStep {
  /** Shared's action name (`Page.navigate`, `Element.fill`), so adapters' command names compare equal. */
  action: string
  target: string
  /** The text a fill typed, as the user sees it, whatever shape the binding packaged it in. */
  input?: string
  outcome: string
  /** The page a replay of this step shows. */
  page: string
  /** The row's timestamp: never compared, but how a violation on this step is found. */
  at: number
  /** The scenario test the row ran in, as an index into SCENARIO_TESTS; -1 outside any. */
  test: number
}

export interface NormalizedRun {
  steps: NormalizedStep[]
  /** The page each DOM anchor belongs to, in order. */
  snapshots: string[]
  runControls: RunControls
  /** The path of every request the Network tab lists, sorted, repeats kept. */
  requests: string[]
}

/** The run controls a metadata frame offers: the capabilities advertised, and whether a command or config serves them. */
export interface RunControls {
  advertised: string[]
  served: boolean
}

/** Two adapters told different stories about the same scenario. */
export interface Divergence extends Violation {
  adapters: [AdapterId, AdapterId]
  /** Each side's row timestamp, when the difference is on one aligned step. */
  at?: Partial<Record<AdapterId, number>>
}

/** A step both sides show once, at different places in one test. */
export interface Move {
  /** The step as each side shows it, compared like any aligned pair. */
  a: NormalizedStep
  b: NormalizedStep
  /** The step each side shows it after. */
  afterA: string
  afterB: string
}

/** What a gap declares its holder never shows, applied by the comparison. */
export interface Lacks {
  /** `Class.method`, or `Class.method target` for one step only. */
  steps: string[]
  /** `Class.method` of steps the holder shows without a target. */
  targets: string[]
}

/** A test the scenario defines, and the state every runner must report it ending in. */
export interface ScenarioTest {
  title: string
  state: 'passed' | 'failed'
}

/** A test as an adapter's suites frames report it. */
export interface ReportedTest {
  uid: string
  title: string
  state: string
  /** Absolute ms. */
  start: number
}

/** How a script reaches the page: a WebDriver function body, a BiDi function declaration, or a BiDi expression. */
export type ScriptForm = 'body' | 'declaration' | 'expression'

/** What places a row in a scenario test: the test it names, and when it ran. */
export type TimedRow = Pick<CommandLog, 'testUid' | 'startTime' | 'timestamp'>

/** How the conformance suite launches one adapter's scenario. */
export interface AdapterScenario {
  id: AdapterId
  /** What the runner exits with when the scenario's tests end as designed: two of them fail. */
  exitCode: number
  /** False only locally, when a prerequisite (a build, an interpreter) is missing; CI must not skip. */
  ready(): boolean
  prepare(): ScenarioLaunch
}

export interface ScenarioLaunch {
  /** The spec the runner executes: the file every call site must name. */
  scenarioFile: string
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  /** Where to run from, for a runner that resolves its own plugins from the working directory; the repo root otherwise. */
  cwd?: string
  cleanup?: () => void
}

/** What the fake browser answers a BiDi command with: a result, or the error a driver would raise. */
export type BidiAnswer =
  { result: unknown } | { error: string; message: string }

export type BidiCommandHandler = (
  method: string,
  params: Record<string, unknown>
) => Promise<BidiAnswer>

/** What a broken rule means and where to look, shown beside a failing run. */
export interface RuleGuide {
  meaning: string
  cause: string
  responsibility: Responsibility
}

/** What every adapter implements, in any language; the adapter guide documents each. */
export type Responsibility = keyof typeof RESPONSIBILITIES

/** Whether a violation's or divergence's message is the one a gap names. */
export type MessageMatcher = (message: string) => boolean

/** A difference an adapter is allowed to show, and why. */
export interface KnownGap {
  adapter: AdapterId
  bidi: BidiMode
  rules: RuleId[]
  reason: string
  /** Set when the gap is a race, so a run that happens to win it is not stale. */
  timingDependent?: boolean
  /** The adapter the gap's differences are judged against; with it absent from a run, the gap cannot be judged stale. */
  against?: AdapterId
  /** Narrows the gap to the violations or divergences whose message matches, so a second bug under the same rule still fails. */
  only?: MessageMatcher
  /** Steps (`Class.method`) the holder never emits: every comparison it is in drops them from both sides, and they excuse nothing else. */
  lacksSteps?: string[]
  /** Steps (`Class.method`) the holder emits without a target: every comparison it is in compares them without one. */
  lacksTargets?: string[]
}

export interface Judgement {
  /** Violations no gap explains: these fail the run. */
  unexplained: Violation[]
  /** Gaps declared for this run that matched nothing, so no longer hold. */
  stale: KnownGap[]
}

export interface ScenarioRun {
  frames: WireFrame[]
  truth: BrowserTruth
  exitCode: number | null
  output: string
}

/** Everything one scenario run produced, as written to the conformance out dir. */
export interface RunReport {
  adapter: AdapterId
  bidi: BidiMode
  exitCode: number | null
  truth: GroundTruth
  violations: Violation[]
  unexplained: Violation[]
  stale: KnownGap[]
  frames: WireFrame[]
  output: string
  /** Set when the checker could not read the stream; the frames are kept so the cause can be seen. */
  checkerError?: string
}

interface TimelineEventBase {
  /** Absolute ms; a report subtracts the run's first event. */
  at: number
  violations: Violation[]
}

export interface DocumentEvent extends TimelineEventBase {
  kind: 'document'
  url: string
}

export interface AnchorEvent extends TimelineEventBase {
  kind: 'anchor'
  url: string
}

export interface RowEvent extends TimelineEventBase {
  kind: 'row'
  command: string
  target: string
  startTime?: number
  timestamp: number
  failed: boolean
}

export type TimelineEvent = DocumentEvent | AnchorEvent | RowEvent

export interface Timeline {
  origin: number
  events: TimelineEvent[]
  /** Violations with no subject, or whose subject is not on the timeline. */
  unplaced: Violation[]
}

/** Where a feature row is rendered: a marker block in a markdown page. */
export type CapabilityTable = keyof typeof CAPABILITY_TABLES

/** How a supported cell is known to hold. */
export type Evidence =
  /** Checked for this adapter by the cross-adapter conformance suite. */
  | { readonly kind: 'rule'; readonly rules: readonly RuleId[] }
  /** Exercised by this test file, a path from the repo root. */
  | { readonly kind: 'test'; readonly path: string }
  /** Checked by hand, with why no automated check covers it yet. */
  | { readonly kind: 'manual'; readonly reason: string }

export type Cell =
  | {
      readonly support: 'supported'
      readonly evidence: Evidence
      readonly label?: string
    }
  | {
      readonly support: 'partial' | 'unsupported'
      readonly reason: string
      readonly label?: string
    }

/** One row of the matrix: a user-facing feature and what each adapter does with it. */
export interface Feature {
  readonly id: string
  readonly name: string
  readonly tables: readonly CapabilityTable[]
  readonly cells: Readonly<Record<AdapterId, Cell>>
}

/** What a user-facing option controls: a feature row, or why it is not one. */
export type OptionTarget<Id extends string = string> =
  { feature: Id } | { notFeature: string }

/** One table in one page file. */
export interface CapabilityTarget {
  table: CapabilityTable
  file: string
}
