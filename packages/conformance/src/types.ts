import type { CommandLog, TraceMutation } from '@wdio/devtools-shared'

import type { ACTION_METHODS, RESPONSIBILITIES, RULES } from './constants.js'

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

/** What happened in the browser, independent of any adapter. */
export interface GroundTruth {
  documents: BrowserDocument[]
  failedNavigations: FailedNavigation[]
  /** How many of each user action the browser received, keyed by shared's action method. */
  actions: Record<ActionMethod, number>
}

export type ActionMethod = (typeof ACTION_METHODS)[number]

export type RuleId = (typeof RULES)[keyof typeof RULES]

/** The timeline event a violation concerns, so a report can show it in place. */
export interface ViolationSubject {
  kind: 'row' | 'anchor' | 'document'
  timestamp: number
}

export interface Violation {
  rule: RuleId
  message: string
  /** Absent when the violation concerns the run as a whole or an event that never happened. */
  subject?: ViolationSubject
}

/** The frame stream as the rules read it: rows after every replaceCommand, anchors in time order. */
export interface RecordedStream {
  frames: WireFrame[]
  rows: CommandLog[]
  anchors: TraceMutation[]
}

export type AdapterId = 'selenium-devtools' | 'selenium-devtools-py'

/** What a broken rule means and where to look, shown beside a failing run. */
export interface RuleGuide {
  meaning: string
  cause: string
  responsibility: Responsibility
}

/** What every adapter implements, in any language; the adapter guide documents each. */
export type Responsibility = keyof typeof RESPONSIBILITIES

/** A difference an adapter is allowed to show, and why. */
export interface KnownGap {
  adapter: AdapterId
  bidi: boolean
  rules: RuleId[]
  reason: string
  /** Set when the gap is a race, so a run that happens to win it is not stale. */
  timingDependent?: boolean
}

export interface Judgement {
  /** Violations no gap explains: these fail the run. */
  unexplained: Violation[]
  /** Gaps declared for this run that matched nothing, so no longer hold. */
  stale: KnownGap[]
}

export interface ScenarioRun {
  frames: WireFrame[]
  truth: GroundTruth
  exitCode: number | null
  output: string
}

/** Everything one scenario run produced, as written to the conformance out dir. */
export interface RunReport {
  adapter: AdapterId
  bidi: boolean
  exitCode: number | null
  truth: GroundTruth
  violations: Violation[]
  unexplained: Violation[]
  stale: KnownGap[]
  frames: WireFrame[]
  output: string
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
