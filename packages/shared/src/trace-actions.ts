// The trace action vocabulary: maps runner-native command names to the trace
// class/method pair. Single source of truth for both the exporter (core, forward
// lookup) and the reader (backend, reverse lookup) so the two cannot drift.

export interface TraceAction {
  class: string
  method: string
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
