// Allow-list mapping from runner-native command names to trace
// vocabulary. Ported from Vince Graics' PR #209 (`@wdio/tracing-service`); the
// existing devtools UI uses its own denylist (`INTERNAL_COMMANDS`) — this map
// is for the trace.zip exporter to filter + rename in one step.

export interface TraceAction {
  class: string
  method: string
}

const ACTION_MAP: Record<string, TraceAction> = {
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
  executeScript: { class: 'Page', method: 'evaluate' },
  switchToFrame: { class: 'Frame', method: 'goto' },
  touchAction: { class: 'Element', method: 'tap' }
}

// clearValue / addValue are excluded: WDIO fires them internally inside setValue
// and they would produce duplicate trace entries.

export function mapCommandToAction(command: string): TraceAction | null {
  return ACTION_MAP[command] ?? null
}

export function formatActionTitle(
  action: TraceAction,
  args: unknown[],
  params?: Record<string, unknown>
): string {
  const firstArg = args[0] ?? params?.selector
  if (firstArg === undefined) {
    return `${action.class}.${action.method}()`
  }
  const label = (
    typeof firstArg === 'object' ? JSON.stringify(firstArg) : String(firstArg)
  ).slice(0, 80)
  return `${action.class}.${action.method}("${label}")`
}
