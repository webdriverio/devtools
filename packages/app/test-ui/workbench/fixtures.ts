// Timeline scenarios shared by the workbench specs. Timestamps are chosen so
// every ordering and duration assertion has exactly one right answer: each
// command's own span differs from the gap that follows it, so a row showing the
// gap where the span was expected (or the reverse) fails.

import type {
  CommandLog,
  TraceActionChild,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

import { commandLog, documentLoaded, mutation } from '../support/builders.js'

/** Wall-clock origin of the fixture run — the offsets below read as ms into it. */
const RUN_START = 1_700_000_000_000

/** `setValue`'s own execution span. Named because the screencast playback
 *  position is taken from it rather than restated as a number. */
const SET_VALUE_START = RUN_START + 700
const SET_VALUE_END = RUN_START + 780

export interface LoginTimeline {
  /** Capture order, which the action tree's `commandIndex` slots refer to. */
  commands: CommandLog[]
  mutations: TraceMutation[]
  /** Spanned navigation: 420ms of its own against a 30ms gap to the next entry. */
  url: CommandLog
  /** Spanned element lookup. */
  findInput: CommandLog
  /** Spanned, and the only command carrying a call source. */
  setValue: CommandLog
  /** Unspanned and last, so its duration can only come from the entry gap. */
  click: CommandLog
  /** The one mutation the panel renders — a childList carrying a url. */
  documentLoad: TraceMutation
  /** An attribute mutation, which is not a document load. */
  attributeChange: TraceMutation
  /** A childList mutation without a url, which is not a document load either. */
  toastInserted: TraceMutation
}

const url = commandLog({
  command: 'url',
  args: ['https://the-internet.herokuapp.com/login'],
  startTime: RUN_START,
  timestamp: RUN_START + 420
})

const findInput = commandLog({
  command: '$',
  args: ['#username'],
  startTime: RUN_START + 600,
  timestamp: RUN_START + 640
})

const setValue = commandLog({
  command: 'setValue',
  args: ['#username', 'tomsmith'],
  callSource: 'login.e2e.ts:12:5',
  startTime: SET_VALUE_START,
  timestamp: SET_VALUE_END
})

/** Playback position used to drive the screencast highlight: the midpoint of
 *  `setValue`'s span, so it falls inside that span and no other. Derived rather
 *  than restated, so retiming the command moves the position with it — the
 *  actions spec asserts through `activeSpanAt` that it still resolves there. */
export const SET_VALUE_PLAYBACK_TIME = (SET_VALUE_START + SET_VALUE_END) / 2

const click = commandLog({
  command: 'click',
  args: ['#submit'],
  timestamp: RUN_START + 1300
})

const documentLoad = documentLoaded(
  'https://the-internet.herokuapp.com/login',
  {
    timestamp: RUN_START + 450
  }
)

const attributeChange = mutation({
  type: 'attributes',
  attributeName: 'aria-invalid',
  attributeValue: 'true',
  timestamp: RUN_START + 900
})

const toastInserted = mutation({
  type: 'childList',
  addedNodes: ['<div class="toast">Saved</div>'],
  timestamp: RUN_START + 1000
})

export const loginTimeline: LoginTimeline = {
  commands: [url, findInput, setValue, click],
  mutations: [attributeChange, documentLoad, toastInserted],
  url,
  findInput,
  setValue,
  click,
  documentLoad,
  attributeChange,
  toastInserted
}

export interface LoginActionTree {
  /** Root children of the tree, referencing `loginTimeline.commands` by index. */
  groups: TraceActionChild[]
  /** Passing step, so it starts collapsed. */
  passingStep: TraceActionGroupNode
  /** Failed step, so it starts expanded. */
  failedStep: TraceActionGroupNode
  /** Passing step nested under the failed one. */
  nestedStep: TraceActionGroupNode
}

const nestedStep: TraceActionGroupNode = {
  callId: 'step-3',
  title: 'Then I see an error message',
  startTime: RUN_START + 800,
  endTime: RUN_START + 1300,
  children: [{ commandIndex: 3 }]
}

const failedStep: TraceActionGroupNode = {
  callId: 'step-2',
  title: 'When I submit invalid credentials',
  startTime: RUN_START + 600,
  endTime: RUN_START + 1300,
  failed: true,
  children: [{ commandIndex: 1 }, { commandIndex: 2 }, { group: nestedStep }]
}

const passingStep: TraceActionGroupNode = {
  callId: 'step-1',
  title: 'Given I open the login page',
  startTime: RUN_START,
  endTime: RUN_START + 450,
  children: [{ commandIndex: 0 }]
}

export const loginActionTree: LoginActionTree = {
  groups: [{ group: passingStep }, { group: failedStep }],
  passingStep,
  failedStep,
  nestedStep
}
