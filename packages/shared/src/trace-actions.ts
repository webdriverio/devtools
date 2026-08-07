// The trace action vocabulary: maps runner-native command names to the trace
// class/method pair. Single source of truth for both the exporter (core, forward
// lookup) and the reader (backend, reverse lookup) so the two cannot drift.

export interface TraceAction {
  class: string
  method: string
}

/** Trace action class assertion commands map to. */
export const ASSERT_ACTION_CLASS = 'Assert'

/** node:assert methods the core assert patcher wraps; the reader derives its
 *  `Assert.<m>` → `assert.<m>` reverse entries from the same list. */
export const TRACKED_ASSERT_METHODS = [
  'equal',
  'strictEqual',
  'deepEqual',
  'deepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'notDeepEqual',
  'notDeepStrictEqual',
  'ok',
  'fail',
  'throws',
  'doesNotThrow',
  'rejects',
  'doesNotReject',
  'match',
  'doesNotMatch'
] as const

// assert.<m> (node:assert), verify.<m> (nightwatch soft variants), and
// expect.<m> (synthesized failing-matcher entries) all render as Assert.
// Only FAILING expect-webdriverio matchers reach the command log today (via the
// reporter); recording passing matchers needs a per-adapter capture change.
const ASSERT_COMMAND_RE = /^(?:assert|verify|expect)\.(\w+)$/

export function mapAssertCommand(command: string): TraceAction | null {
  const match = ASSERT_COMMAND_RE.exec(command)
  return match ? { class: ASSERT_ACTION_CLASS, method: match[1] } : null
}

export const ACTION_MAP: Record<string, TraceAction> = {
  // WDIO browser-level
  url: { class: 'Page', method: 'navigate' },
  navigateTo: { class: 'Page', method: 'navigate' },
  back: { class: 'Page', method: 'goBack' },
  forward: { class: 'Page', method: 'goForward' },
  refresh: { class: 'Page', method: 'reload' },
  newWindow: { class: 'Page', method: 'goto' },
  // Selenium WebDriver navigation (driver.get, driver.navigate().to/back/forward/refresh)
  get: { class: 'Page', method: 'navigate' },
  to: { class: 'Page', method: 'navigate' },
  // WDIO element-level
  click: { class: 'Element', method: 'click' },
  doubleClick: { class: 'Element', method: 'dblclick' },
  setValue: { class: 'Element', method: 'fill' },
  selectByVisibleText: { class: 'Element', method: 'selectOption' },
  moveTo: { class: 'Element', method: 'hover' },
  scrollIntoView: { class: 'Element', method: 'scrollIntoViewIfNeeded' },
  dragAndDrop: { class: 'Element', method: 'dragTo' },
  // Selenium WebElement actions
  sendKeys: { class: 'Element', method: 'fill' },
  clear: { class: 'Element', method: 'clear' },
  submit: { class: 'Element', method: 'submit' },
  // Cross-runner
  keys: { class: 'Keyboard', method: 'press' },
  execute: { class: 'Page', method: 'evaluate' },
  executeAsync: { class: 'Page', method: 'evaluate' },
  switchToFrame: { class: 'Frame', method: 'goto' },
  touchAction: { class: 'Element', method: 'tap' },
  // WDIO element reads — surfaced so query steps appear in the timeline the way
  // locator queries do in standard trace viewers. Adapters already capture
  // these; only the export allow-list kept them out.
  getText: { class: 'Element', method: 'getText' },
  getValue: { class: 'Element', method: 'getValue' },
  getAttribute: { class: 'Element', method: 'getAttribute' },
  getProperty: { class: 'Element', method: 'getProperty' },
  getCSSProperty: { class: 'Element', method: 'getCSSProperty' },
  getTagName: { class: 'Element', method: 'getTagName' },
  getLocation: { class: 'Element', method: 'getLocation' },
  getSize: { class: 'Element', method: 'getSize' },
  isDisplayed: { class: 'Element', method: 'isDisplayed' },
  isExisting: { class: 'Element', method: 'isExisting' },
  isEnabled: { class: 'Element', method: 'isEnabled' },
  isSelected: { class: 'Element', method: 'isSelected' },
  isClickable: { class: 'Element', method: 'isClickable' },
  isFocused: { class: 'Element', method: 'isFocused' },
  // Explicit user-facing waits (not the internal polling loops behind them).
  waitForDisplayed: { class: 'Element', method: 'waitForDisplayed' },
  waitForExist: { class: 'Element', method: 'waitForExist' },
  waitForEnabled: { class: 'Element', method: 'waitForEnabled' },
  waitForClickable: { class: 'Element', method: 'waitForClickable' },
  waitUntil: { class: 'Browser', method: 'waitForFunction' },
  // Nightwatch's wait family, normalized onto the WDIO names above. These are
  // written by the user and are the commands a Nightwatch test most often fails
  // on, so leaving them out of the allow-list meant the failing step produced no
  // row at all — and with no row, its error had nowhere to attach and neither the
  // action list nor the Errors tab showed the failure.
  waitForElementVisible: { class: 'Element', method: 'waitForDisplayed' },
  waitForElementNotVisible: { class: 'Element', method: 'waitForHidden' },
  waitForElementPresent: { class: 'Element', method: 'waitForExist' },
  waitForElementNotPresent: { class: 'Element', method: 'waitForNotExist' },
  // WDIO page/browser reads
  getTitle: { class: 'Page', method: 'getTitle' },
  getUrl: { class: 'Page', method: 'getUrl' },
  getPageSource: { class: 'Page', method: 'getPageSource' },
  // Selenium read aliases — normalized onto the WDIO names above so both runners
  // read identically. getText/getAttribute/getTagName/isDisplayed/isEnabled/
  // isSelected share the command name across runners and need no alias.
  getCssValue: { class: 'Element', method: 'getCSSProperty' },
  getRect: { class: 'Element', method: 'getRect' },
  getCurrentUrl: { class: 'Page', method: 'getUrl' }
}

/** Trace methods (ACTION_MAP values) that act at a point on the page — the
 *  exporter emits a hit `point` for these so the player can mark where the
 *  action landed. `fill` is included (typing focuses the element first). */
export const POINTABLE_METHODS: ReadonlySet<string> = new Set([
  'click',
  'dblclick',
  'hover',
  'tap',
  'dragTo',
  'scrollIntoViewIfNeeded',
  'selectOption',
  'fill'
])

/** Runner command names (native or trace method) that type into an element —
 *  drives the timeline's keyboard glyph vs the pointer glyph. */
const KEYBOARD_COMMANDS: ReadonlySet<string> = new Set([
  'setValue',
  'sendKeys',
  'addValue',
  'clearValue',
  'clear',
  'keys',
  'fill',
  'press'
])

export function isKeyboardCommand(command: string): boolean {
  return KEYBOARD_COMMANDS.has(command)
}

/** Runner-native pointer commands the trace vocabulary deliberately doesn't
 *  name — Nightwatch's low-level mouse API has no meaningful trace method, so
 *  adding it to ACTION_MAP would put noise in the timeline. Listed here because
 *  they still dispatch, and a command that dispatches unrecognized keeps the
 *  screenshot poll running straight through it. */
const UNMAPPED_POINTER_COMMANDS: ReadonlySet<string> = new Set([
  'moveToElement',
  'mouseButtonClick',
  'mouseButtonDown',
  'mouseButtonUp',
  'rightClick',
  'submitForm'
])

/**
 * Whether a runner command makes the driver dispatch trusted input into the
 * page. Derived from the vocabulary above rather than declared as a second list:
 * a command qualifies when it types (`isKeyboardCommand`) or when its trace
 * method acts at a point (`POINTABLE_METHODS`). A command wrongly classified as
 * non-dispatching is the costly direction — it leaves the screencast poll racing
 * the dispatch — so the unmapped pointer commands above are named explicitly.
 */
export function isInputDispatchingCommand(command: string): boolean {
  if (isKeyboardCommand(command) || UNMAPPED_POINTER_COMMANDS.has(command)) {
    return true
  }
  const action = ACTION_MAP[command]
  return action !== undefined && POINTABLE_METHODS.has(action.method)
}
