// Trace-player scenarios shared by the snapshot and trace-timeline specs, built
// on `support/builders.ts`. The captured pages mirror what `packages/script`
// serializes: every element carries the `data-wdio-ref` attribute the replay
// matches mutations against, and form state arrives as a synthetic
// `value` / `checked` attribute mutation the way the collector emits it
// (`String(el.value)` / `String(el.checked)`).
//
// The two producers each shape gets its shape from, so a change on either side
// shows up here:
//   `parseDocument`  (collector.captureCurrentDom) → the full-DOM anchor
//   `parseFragment`  (serializeMutation)           → every added node
// both via `parseNode`, which builds nodes with preact's `h()`.

import { TraceType } from '@wdio/devtools-shared'
import type {
  CommandLog,
  Metadata,
  MetadataBySession,
  TracePlayerFrame
} from '@wdio/devtools-shared'

import type { SimplifiedVNode } from '../../../../script/types'
import { commandLog, documentLoaded, mutation } from '../../support/builders.js'

/** Wall-clock origin of the fixture run — every offset below reads as ms into it. */
const RUN_START = 1_700_000_000_000

export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
export const SECURE_URL = 'https://the-internet.herokuapp.com/secure'
export const METADATA_URL = 'https://the-internet.herokuapp.com/from-metadata'

/**
 * Value the login page was captured with. Preact applies a non-empty `value` as
 * a PROPERTY, which raises the input's dirty-value flag — from then on the
 * `value` attribute alone no longer moves what the field displays. So a replay
 * that set the attribute without mirroring the property would keep showing this
 * string after the test typed over it.
 */
export const STALE_USERNAME = 'olduser'
export const TYPED_USERNAME = 'tomsmith'
export const FLASH_TEXT = 'You logged into a secure area!'

/** Session id of the recording the screencast view plays. */
export const VIDEO_SESSION_ID = 'session-secure'

/** Distinct 1x1 PNGs, so a spec can tell which frame is on screen. */
export const LOGIN_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4o6EBAAMQAS0Qc/Z2AAAAAElFTkSuQmCC'
export const SECURE_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPQqLgDAAJIAX2kVPgTAAAAAElFTkSuQmCC'
export const FRAME_SHOT =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP48OEDAAWkAtFkkTHCAAAAAElFTkSuQmCC'

/** Refs the mutation stream targets. `assignRef` numbers them and stamps one on
 *  EVERY element of the captured tree (`<html>` and `<head>` included); the
 *  names here cover only the elements the specs address, and read better in an
 *  assertion than a serial number. */
export const REF = {
  body: 'body-ref',
  form: 'form-ref',
  username: 'username-ref',
  password: 'password-ref',
  remember: 'remember-ref',
  planGuest: 'plan-guest-ref',
  planMember: 'plan-member-ref',
  submit: 'submit-ref',
  error: 'error-ref',
  secureBody: 'secure-body-ref',
  flash: 'flash-ref',
  logout: 'logout-ref'
} as const

/** A serialized element as the collector emits it — attributes and the child
 *  list share `props`, and a wrapper fragment carries no `type` at all. */
interface CapturedNode {
  type?: string
  props: Record<string, string | CapturedNode | CapturedNode[]>
}

/**
 * One serialized element, shaped as `parseNode` leaves it: attributes spread
 * onto `props`, children under `props.children` — a single child BARE, several
 * as an array. That split is not cosmetic: `parseNode` builds each node with
 * preact's `h()`, and `h(type, props, one)` stores that one child as-is, so a
 * real capture of `body > form` hands the replay an object where a capture of
 * `body > [div, a]` hands it an array. Always emitting an array would leave the
 * single-child path — the common one — untested.
 */
function vnode(
  type: string,
  props: Record<string, string>,
  ...children: CapturedNode[]
): CapturedNode {
  if (children.length === 0) {
    return { type, props }
  }
  return {
    type,
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children
    }
  }
}

/**
 * An added node as `serializeMutation` puts it on the wire. `parseFragment`
 * serializes a documentFragment, whose nodeName yields no tagName, so every
 * added node arrives inside a TYPELESS node holding it as its only child —
 * the wrapper `vnode-transform`'s ToDo branch unwraps on replay.
 */
function capturedFragment(node: CapturedNode): CapturedNode {
  return { props: { children: node } }
}

/**
 * A captured page as `parseDocument` emits it: `html > [head, body]`, since
 * parse5 always materialises both. `head` takes at least two nodes here because
 * the replay prepends its `<base>` by spreading `head.props.children` — a real
 * page with a single `<title>` therefore hands it a bare object, the rebuild
 * throws, and the iframe stays blank (see `vnode-transform.test.ts`).
 */
function capturedDocument(
  head: readonly [CapturedNode, CapturedNode, ...CapturedNode[]],
  body: CapturedNode
): CapturedNode {
  return vnode('html', { lang: 'en' }, vnode('head', {}, ...head), body)
}

/** Hands a captured tree to the mutation builders. `SimplifiedVNode` types its
 *  props as `Record<string, string>`, which cannot also hold the child list the
 *  real payload carries — `packages/script` casts for the same reason — so the
 *  tree is built with an honest shape and narrowed here. */
const payload = (node: CapturedNode) => node as unknown as SimplifiedVNode

const loginPage = payload(
  capturedDocument(
    [
      vnode('meta', { charset: 'utf-8' }),
      // Never runs on replay — the player strips the captured page's scripts.
      vnode('script', { src: '/login.js' })
    ],
    vnode(
      'body',
      { 'data-wdio-ref': REF.body },
      vnode(
        'form',
        { id: 'login', 'data-wdio-ref': REF.form },
        vnode('input', {
          id: 'username',
          type: 'text',
          name: 'username',
          value: STALE_USERNAME,
          'data-wdio-ref': REF.username
        }),
        vnode('input', {
          id: 'password',
          type: 'password',
          name: 'password',
          'data-wdio-ref': REF.password
        }),
        vnode('input', {
          id: 'remember',
          type: 'checkbox',
          'data-wdio-ref': REF.remember
        }),
        vnode('input', {
          id: 'plan-guest',
          type: 'radio',
          name: 'plan',
          checked: 'checked',
          'data-wdio-ref': REF.planGuest
        }),
        vnode('input', {
          id: 'plan-member',
          type: 'radio',
          name: 'plan',
          'data-wdio-ref': REF.planMember
        }),
        vnode('button', {
          id: 'submit',
          type: 'submit',
          'data-wdio-ref': REF.submit
        })
      )
    )
  )
)

const securePage = payload(
  capturedDocument(
    [
      vnode('meta', { charset: 'utf-8' }),
      vnode('meta', { name: 'viewport', content: 'width=device-width' })
    ],
    vnode(
      'body',
      { 'data-wdio-ref': REF.secureBody },
      vnode('div', {
        id: 'flash',
        class: 'success',
        'data-wdio-ref': REF.flash
      }),
      vnode('a', { id: 'logout', href: '/logout', 'data-wdio-ref': REF.logout })
    )
  )
)

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
 * SYNTHETIC — no real trace carries this shape, and the replay branch it drives
 * (`#handleCharacterDataMutation`) is dead against recorded data, for two
 * independent reasons:
 *
 *  1. `packages/script` never records one. Its MutationObserver is configured
 *     `{ attributes, childList, subtree }` — `characterData` is not observed, so
 *     no such record ever reaches `serializeMutation`.
 *  2. Even if it were observed, the target would not resolve. A characterData
 *     record's `target` is the mutated TEXT node, and `serializeMutation` sets
 *     `target: getRef(m.target)`; `getRef` returns null for anything without
 *     `getAttribute`, so the wire value is null and the replay's
 *     `#queryElement(null)` looks for `[data-wdio-ref="null"]` — never a match.
 *
 * A resolvable `target` is what makes this fixture's mutation apply at all, and
 * that is exactly the part production cannot produce. `textNodeTrace` below
 * carries the shape a real capture WOULD have, and the spec asserts against it
 * that the branch does nothing.
 */
const flashText = mutation({
  type: 'characterData',
  target: REF.flash,
  newTextContent: FLASH_TEXT,
  timestamp: RUN_START + 1600
})

/** The `target` a characterData record really arrives with: `getRef()` on a Text
 *  node returns null. `TraceMutation.target` is typed `string | undefined`, so
 *  the wire value is cast once here rather than softened to `undefined` — the
 *  point of the fixture is to be the value the reader hands the player. */
const TEXT_NODE_TARGET = null as unknown as string

const flashTextAsCaptured = mutation({
  type: 'characterData',
  target: TEXT_NODE_TARGET,
  newTextContent: FLASH_TEXT,
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
  /** Flash text arriving on the secure page — a shape only this fixture has;
   *  see the note above its definition. */
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

export interface TextNodeTrace extends TraceScenario {
  /** Last command, so its DOM window runs to the end of the mutation stream —
   *  the replay walks the anchor, then the text change, then the class change. */
  readFlash: CommandLog
  /** A characterData mutation exactly as a capture would carry it: `target` is
   *  the null `getRef()` returns for a Text node. */
  flashTextAsCaptured: TraceMutation
  /** Applied after it, so the spec has a signal that is uniquely true once the
   *  whole window has replayed — without it a missing text change and an
   *  unfinished replay look the same. */
  flashDismissed: TraceMutation
}

/** The secure page as `packages/script` would really record its flash text. */
export const textNodeTrace: TextNodeTrace = {
  commands: [readFlash],
  mutations: [securePageDocument, flashTextAsCaptured, flashDismissed],
  readFlash,
  flashTextAsCaptured,
  flashDismissed
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

const viewport = {
  width: 1280,
  height: 800,
  offsetLeft: 0,
  offsetTop: 0,
  scale: 1
}

/** Default metadata: viewport only, so no assertion can pass through its url. */
export const viewportMetadata: Metadata = {
  type: TraceType.Testrunner,
  viewport
}

/** Metadata that does carry a url, for the address-bar fallback. */
export const urlMetadata: Metadata = {
  type: TraceType.Testrunner,
  url: METADATA_URL,
  viewport
}

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
