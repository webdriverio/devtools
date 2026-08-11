// Trace-player scenarios shared by the snapshot and trace-timeline specs, built
// on `support/builders.ts` and on the captured pages in `captured-pages.ts`. Form
// state arrives as a synthetic `value` / `checked` attribute mutation the way the
// collector emits it (`String(el.value)` / `String(el.checked)`).

import { TraceType } from '@wdio/devtools-shared'
import type {
  CommandLog,
  Metadata,
  MetadataBySession,
  TracePlayerFrame
} from '@wdio/devtools-shared'

import { commandLog, documentLoaded, mutation } from '../../support/builders.js'
import {
  capturedFragment,
  FLASH_TEXT,
  loginPage,
  NOTICE_TAIL_UPDATED,
  payload,
  REF,
  securePage,
  TYPED_USERNAME,
  vnode
} from './captured-pages.js'

/** Wall-clock origin of the fixture run — every offset below reads as ms into it. */
const RUN_START = 1_700_000_000_000

export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
export const SECURE_URL = 'https://the-internet.herokuapp.com/secure'
export const METADATA_URL = 'https://the-internet.herokuapp.com/from-metadata'

/** Session id of the recording the screencast view plays. */
export const VIDEO_SESSION_ID = 'session-secure'

/** Distinct 1x1 PNGs, so a spec can tell which frame is on screen. */
export const LOGIN_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4o6EBAAMQAS0Qc/Z2AAAAAElFTkSuQmCC'
export const SECURE_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPQqLgDAAJIAX2kVPgTAAAAAElFTkSuQmCC'
export const FRAME_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OEDAAWkAtFkkTHCAAAAAElFTkSuQmCC'

/** The two streams one player mount consumes. */
export interface TraceScenario {
  commands: CommandLog[]
  mutations: TraceMutation[]
}

const openLogin = commandLog({
  command: 'url',
  args: [LOGIN_URL],
  startTime: RUN_START,
  timestamp: RUN_START + 400
})

const findUsername = commandLog({
  command: '$',
  args: ['#username'],
  startTime: RUN_START + 600,
  timestamp: RUN_START + 640
})

const typeUsername = commandLog({
  command: 'setValue',
  args: ['#username', TYPED_USERNAME],
  callSource: 'login.e2e.ts:14:5',
  startTime: RUN_START + 700,
  timestamp: RUN_START + 780
})

const submit = commandLog({
  command: 'click',
  args: ['#submit'],
  point: { x: 320, y: 480 },
  startTime: RUN_START + 1200,
  timestamp: RUN_START + 1260
})

const readFlash = commandLog({
  command: 'getText',
  args: ['#flash'],
  title: 'expect(#flash).toHaveText',
  startTime: RUN_START + 1500,
  timestamp: RUN_START + 1520
})

const loginDocument = documentLoaded(LOGIN_URL, {
  addedNodes: [loginPage],
  timestamp: RUN_START + 450
})

const usernameCleared = mutation({
  target: REF.username,
  attributeName: 'value',
  attributeValue: '',
  timestamp: RUN_START + 740
})

const usernameTyped = mutation({
  target: REF.username,
  attributeName: 'value',
  attributeValue: TYPED_USERNAME,
  timestamp: RUN_START + 760
})

const rememberChecked = mutation({
  target: REF.remember,
  attributeName: 'checked',
  attributeValue: 'true',
  timestamp: RUN_START + 800
})

const rememberUnchecked = mutation({
  target: REF.remember,
  attributeName: 'checked',
  attributeValue: 'false',
  timestamp: RUN_START + 830
})

const planSelected = mutation({
  target: REF.planMember,
  attributeName: 'checked',
  attributeValue: 'true',
  timestamp: RUN_START + 860
})

const securePageDocument = documentLoaded(SECURE_URL, {
  addedNodes: [securePage],
  timestamp: RUN_START + 1400
})

/**
 * A characterData mutation as `packages/script` records one. The mutated node is
 * a Text node, which carries no ref of its own, so the collector addresses it
 * as its PARENT element's ref plus its index among that parent's `childNodes` —
 * `newTextContent` is that one node's new data, never the parent's whole text.
 */
const flashText = mutation({
  type: 'characterData',
  target: REF.flash,
  childIndex: 0,
  newTextContent: FLASH_TEXT,
  timestamp: RUN_START + 1600
})

/** `#notice`'s trailing text — child index 2, AFTER its `<strong>` element child
 *  and after its own leading text. Both of those staying untouched is what
 *  proves the patch reached one node rather than the parent's text as a whole. */
const noticeTailChanged = mutation({
  type: 'characterData',
  target: REF.notice,
  childIndex: 2,
  newTextContent: NOTICE_TAIL_UPDATED,
  timestamp: RUN_START + 1560
})

/**
 * An index the replayed parent does not have. Real captures produce these: the
 * index counts the captured parent's childNodes, and the player strips the page's
 * `<script>` children, so anything after one shifts down. `#flash` has a single
 * text child, which is what the replay falls back to.
 */
const flashOutOfRange = mutation({
  type: 'characterData',
  target: REF.flash,
  childIndex: 9,
  newTextContent: FLASH_TEXT,
  timestamp: RUN_START + 1560
})

/**
 * A characterData mutation with no `childIndex` — every trace recorded before the
 * collector addressed text nodes, and the shape the replay must refuse to apply:
 * with only a parent ref to go on it would have to write the parent's
 * `textContent`, deleting its element children.
 */
const noticeUnaddressed = mutation({
  type: 'characterData',
  target: REF.notice,
  childIndex: undefined,
  newTextContent: NOTICE_TAIL_UPDATED,
  timestamp: RUN_START + 1580
})

/** `getRef()` on a removed Text node returns null — the only signal the wire
 *  carries that a childList mutation dropped a non-element child.
 *  `TraceMutation.removedNodes` is typed `string[]`, so the value the reader
 *  really hands the player is cast once here. */
const REMOVED_TEXT_NODE = null as unknown as string

/**
 * `el.textContent = …` as a capture records it: one childList record adding the
 * new text (a bare string — `parseFragment` returns an added Text node's data)
 * and removing the old Text node, which has no ref to name it by.
 */
const flashTextReplaced = mutation({
  type: 'childList',
  target: REF.flash,
  addedNodes: [FLASH_TEXT],
  removedNodes: [REMOVED_TEXT_NODE],
  timestamp: RUN_START + 1600
})

const flashDismissed = mutation({
  target: REF.flash,
  attributeName: 'class',
  attributeValue: 'success dismissed',
  timestamp: RUN_START + 1650
})

export interface LoginTrace extends TraceScenario {
  /** Navigation, spanning 0–400ms — the first action on the timeline. */
  openLogin: CommandLog
  /** Element lookup, and the bound that ends `openLogin`'s DOM window. */
  findUsername: CommandLog
  /** Fills `#username`; its result state is the whole login-form field batch. */
  typeUsername: CommandLog
  /** Navigating click: the DOM it produced is captured 140ms AFTER it ended. */
  submit: CommandLog
  /** Last command, so its DOM window is unbounded, and the only one carrying a
   *  display title. */
  readFlash: CommandLog
  /** Full-DOM anchor of the login page. */
  loginDocument: TraceMutation
  /** Prefilled email wiped before typing (`clearValue` half of `setValue`). */
  usernameCleared: TraceMutation
  /** The typed email — the field state a replay must show. */
  usernameTyped: TraceMutation
  rememberChecked: TraceMutation
  /** Same checkbox unticked again, so the two states are separable. */
  rememberUnchecked: TraceMutation
  /** Radio move: picks `#plan-member` away from the captured `#plan-guest`. */
  planSelected: TraceMutation
  /** Full-DOM anchor of the page the click navigated to. */
  securePageDocument: TraceMutation
  /** Flash text arriving on the secure page as a characterData record. */
  flashText: TraceMutation
}

export const loginTrace: LoginTrace = {
  commands: [openLogin, findUsername, typeUsername, submit, readFlash],
  mutations: [
    loginDocument,
    usernameCleared,
    usernameTyped,
    rememberChecked,
    rememberUnchecked,
    planSelected,
    securePageDocument,
    flashText
  ],
  openLogin,
  findUsername,
  typeUsername,
  submit,
  readFlash,
  loginDocument,
  usernameCleared,
  usernameTyped,
  rememberChecked,
  rememberUnchecked,
  planSelected,
  securePageDocument,
  flashText
}

/** A text-change scenario. Only the command needs a handle — every assertion is
 *  about the replayed DOM, and `flashDismissed` closing each stream gives the
 *  spec one signal that is uniquely true once the whole window has replayed
 *  (without it a text change that never landed and an unfinished replay look the
 *  same). */
export interface TextTrace extends TraceScenario {
  /** Last command, so its DOM window runs to the end of the mutation stream. */
  readFlash: CommandLog
}

/** Text changes as `packages/script` records them: a characterData patch of one
 *  text child of `#notice`, and `#flash`'s text replaced wholesale the way a
 *  `textContent` write arrives. The two targets are different elements, so
 *  neither case can mask the other. */
export const textNodeTrace: TextTrace = {
  commands: [readFlash],
  mutations: [
    securePageDocument,
    noticeTailChanged,
    flashTextReplaced,
    flashDismissed
  ],
  readFlash
}

/** Text mutations the replay cannot resolve exactly: `#flash`'s is addressed past
 *  the end of the replayed parent, `#notice`'s carries no index at all. */
export const looseTextTrace: TextTrace = {
  commands: [readFlash],
  mutations: [
    securePageDocument,
    flashOutOfRange,
    noticeUnaddressed,
    flashDismissed
  ],
  readFlash
}

const launchSession = commandLog({
  command: 'url',
  args: [LOGIN_URL],
  startTime: RUN_START,
  timestamp: RUN_START + 100
})

const waitForForm = commandLog({
  command: 'waitForExist',
  args: ['#login'],
  startTime: RUN_START + 150,
  timestamp: RUN_START + 320
})

export interface PreCaptureTrace extends TraceScenario {
  /** Ran and ended before the first DOM was captured, and `waitForForm` starts
   *  before it too — so no mutation falls inside its window. */
  launchSession: CommandLog
  /** Last command, so it resolves to the final captured DOM. */
  waitForForm: CommandLog
}

/** A slice whose first commands precede its initial full-DOM capture. */
export const preCaptureTrace: PreCaptureTrace = {
  commands: [launchSession, waitForForm],
  mutations: [loginDocument, securePageDocument],
  launchSession,
  waitForForm
}

const errorInserted = mutation({
  type: 'childList',
  target: REF.form,
  addedNodes: [
    payload(
      capturedFragment(vnode('p', { id: 'error', 'data-wdio-ref': REF.error }))
    )
  ],
  nextSibling: REF.submit,
  timestamp: RUN_START + 900
})

const rememberRemoved = mutation({
  type: 'childList',
  target: REF.form,
  addedNodes: [],
  removedNodes: [REF.remember],
  timestamp: RUN_START + 950
})

const submitInvalid = commandLog({
  command: 'click',
  args: ['#submit'],
  startTime: RUN_START + 800,
  timestamp: RUN_START + 860
})

const readError = commandLog({
  command: 'getText',
  args: ['#error'],
  startTime: RUN_START + 1000,
  timestamp: RUN_START + 1020
})

export interface ValidationTrace extends TraceScenario {
  /** Its DOM window covers both childList mutations below. */
  submitInvalid: CommandLog
  readError: CommandLog
  /** Adds `#error` before `#submit` rather than at the end of the form. */
  errorInserted: TraceMutation
  /** Drops the remember-me checkbox from the form. */
  rememberRemoved: TraceMutation
}

/** A failed submit: the page grows an error node and drops another. */
export const validationTrace: ValidationTrace = {
  commands: [submitInvalid, readError],
  mutations: [loginDocument, errorInserted, rememberRemoved],
  submitInvalid,
  readError,
  errorInserted,
  rememberRemoved
}

const orphanedValue = mutation({
  target: 'detached-ref',
  attributeName: 'value',
  attributeValue: 'never applied',
  timestamp: RUN_START + 700
})

export interface OrphanTrace extends TraceScenario {
  /** Targets a ref that is not in the captured page. */
  orphanedValue: TraceMutation
  /** Replayed after the orphan, so it proves the replay carried on. */
  usernameTyped: TraceMutation
}

export const orphanTrace: OrphanTrace = {
  commands: [typeUsername],
  mutations: [loginDocument, orphanedValue, usernameTyped],
  orphanedValue,
  usernameTyped
}

const clickCancel = commandLog({
  command: 'click',
  args: ['#cancel'],
  startTime: RUN_START + 900,
  timestamp: RUN_START + 940
})

const readPassword = commandLog({
  command: 'getValue',
  args: ['#password'],
  startTime: RUN_START + 1000,
  timestamp: RUN_START + 1020
})

/**
 * One command per accessible-name branch, all four locators resolving on the
 * login page: `#username` (placeholder only), `#submit` (visible text),
 * `#cancel` (`aria-label` over its own text) and `#password` (nothing). The
 * login anchor is the only mutation, so the overlay measures the captured page
 * itself rather than a replayed edit of it.
 */
export const overlayLabelTrace: TraceScenario = {
  commands: [findUsername, submit, clickCancel, readPassword],
  mutations: [loginDocument]
}

const navigate = commandLog({
  command: 'url',
  args: [LOGIN_URL],
  screenshot: LOGIN_SHOT,
  startTime: RUN_START,
  timestamp: RUN_START + 400
})

const clickSubmit = commandLog({
  command: 'click',
  args: ['#submit'],
  screenshot: SECURE_SHOT,
  startTime: RUN_START + 1200,
  timestamp: RUN_START + 1260
})

const assertFlash = commandLog({
  command: 'isDisplayed',
  args: ['#flash'],
  startTime: RUN_START + 1500,
  timestamp: RUN_START + 1520
})

export interface DomlessTrace extends TraceScenario {
  navigate: CommandLog
  clickSubmit: CommandLog
  /** Assertions capture no frame of their own. */
  assertFlash: CommandLog
}

/** A foreign / DOM-less trace: screenshots only, no mutation stream. */
export const domlessTrace: DomlessTrace = {
  commands: [navigate, clickSubmit, assertFlash],
  mutations: [],
  navigate,
  clickSubmit,
  assertFlash
}

/**
 * A document anchor is a childList of one added node with no target; this one
 * carries no url, which is what makes the player fall back for the address bar.
 *
 * SYNTHETIC in that respect: `captureCurrentDom` always stamps
 * `window.location.href` on the anchor it emits, so a recorded anchor has a url.
 * The fallback is reached from the other direction instead — a slice whose first
 * mutation is not an anchor at all leaves `#renderBrowserState` on `mutations[0]`
 * with no url. Driving it from a url-less anchor is the only way to exercise the
 * fallback and still have a document to replay.
 */
const urllessDocument = mutation({
  type: 'childList',
  target: undefined,
  addedNodes: [loginPage],
  timestamp: RUN_START + 450
})

export const urllessTrace: TraceScenario = {
  commands: [],
  mutations: [urllessDocument]
}

/** The viewport every page here was captured at — the size the replay iframe has
 *  to be laid out at whatever the pane it is then scaled into. */
export const CAPTURED_VIEWPORT = { width: 1280, height: 800 }

const viewport = {
  ...CAPTURED_VIEWPORT,
  offsetLeft: 0,
  offsetTop: 0,
  scale: 1
}

/** Default metadata: viewport only, so no assertion can pass through its url. */
export const viewportMetadata: Metadata = {
  type: TraceType.Testrunner,
  viewport
}

/** A capture taken at some other viewport, so a spec can tell a read of the
 *  captured size from the 1280×800 the player falls back to. */
export const metadataForViewport = (
  width: number,
  height: number
): Metadata => ({
  type: TraceType.Testrunner,
  viewport: { ...viewport, width, height }
})

/** Metadata whose viewport never made it onto the wire — the race the player
 *  defaults for. */
export const viewportlessMetadata: Metadata = { type: TraceType.Testrunner }

/** Metadata that does carry a url, for the address-bar fallback. */
export const urlMetadata: Metadata = {
  type: TraceType.Testrunner,
  url: METADATA_URL,
  viewport
}

/**
 * Window of the screencast the player plays: the whole fixture run, from the
 * first command's start over 2000ms. Every command of `loginTrace` therefore
 * falls inside it, and the scrubber's markers land at exact percentages.
 */
export const RECORDING = { startTime: RUN_START, duration: 2000 }

/** Per-session metadata for the recording the screencast view plays. */
export const recordedSessionMetadata: MetadataBySession = {
  [VIDEO_SESSION_ID]: {
    type: TraceType.Testrunner,
    url: SECURE_URL,
    viewport
  }
}

const firstFrame: TracePlayerFrame = {
  timestamp: RUN_START,
  screenshot: FRAME_SHOT
}

const typingFrame: TracePlayerFrame = {
  timestamp: RUN_START + 750,
  screenshot: LOGIN_SHOT
}

const lastFrame: TracePlayerFrame = {
  timestamp: RUN_START + 2000,
  screenshot: SECURE_SHOT
}

export interface Filmstrip {
  frames: TracePlayerFrame[]
  /** Recording start — active while the playhead sits at zero, and the origin
   *  every timeline position is measured from. */
  first: TracePlayerFrame
  /** Falls inside `typeUsername`'s span, so clicking it selects that command. */
  typing: TracePlayerFrame
  /** End of the window: with it the strip spans exactly 2000ms. */
  last: TracePlayerFrame
}

/** Frames at 0 / 500 / 750 / 1250 / 2000ms into `loginTrace`, so every position
 *  the strip renders is an exact percentage. */
export const filmstrip: Filmstrip = {
  frames: [
    firstFrame,
    { timestamp: RUN_START + 500, screenshot: SECURE_SHOT },
    typingFrame,
    { timestamp: RUN_START + 1250, screenshot: FRAME_SHOT },
    lastFrame
  ],
  first: firstFrame,
  typing: typingFrame,
  last: lastFrame
}
