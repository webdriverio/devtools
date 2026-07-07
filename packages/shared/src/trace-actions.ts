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
  touchAction: { class: 'Element', method: 'tap' }
}
