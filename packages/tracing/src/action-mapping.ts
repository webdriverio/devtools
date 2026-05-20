export interface TraceAction {
  class: string
  method: string
}

const ACTION_MAP: Record<string, TraceAction> = {
  url: { class: 'Page', method: 'navigate' },
  navigateTo: { class: 'Page', method: 'navigate' },
  back: { class: 'Page', method: 'goBack' },
  forward: { class: 'Page', method: 'goForward' },
  refresh: { class: 'Page', method: 'reload' },
  newWindow: { class: 'Page', method: 'goto' },
  click: { class: 'Element', method: 'click' },
  doubleClick: { class: 'Element', method: 'dblclick' },
  setValue: { class: 'Element', method: 'fill' },
  selectByVisibleText: { class: 'Element', method: 'selectOption' },
  moveTo: { class: 'Element', method: 'hover' },
  scrollIntoView: { class: 'Element', method: 'scrollIntoViewIfNeeded' },
  dragAndDrop: { class: 'Element', method: 'dragTo' },
  keys: { class: 'Keyboard', method: 'press' },
  execute: { class: 'Page', method: 'evaluate' },
  executeAsync: { class: 'Page', method: 'evaluate' },
  executeScript: { class: 'Page', method: 'evaluate' },
  switchToFrame: { class: 'Frame', method: 'goto' },
  touchAction: { class: 'Element', method: 'tap' },
  // browser.action().perform() — special registration in register-overwrites.ts
  action: { class: 'Mouse', method: 'tap' },
}

// clearValue and addValue are excluded: they are always fired internally by setValue
// and would produce duplicate trace events for every fill action.

export const ELEMENT_COMMANDS = new Set([
  'click',
  'doubleClick',
  'setValue',
  'selectByVisibleText',
  'moveTo',
  'scrollIntoView',
  'dragAndDrop',
  'touchAction'
])

// 'action' excluded: handled via special overwrite in register-overwrites.ts,
// not the generic browser command loop.
export const BROWSER_COMMAND_LIST = Object.keys(ACTION_MAP).filter(
  (c) => !ELEMENT_COMMANDS.has(c) && c !== 'action'
)

export const ELEMENT_COMMAND_LIST = [...ELEMENT_COMMANDS]

export function mapCommandToAction(command: string): TraceAction | null {
  return ACTION_MAP[command] ?? null
}

export function formatActionTitle(
  action: TraceAction,
  command: string,
  args: unknown[],
  params?: Record<string, unknown>
): string {
  // Pointer/touch action: extract x,y from the sequence's first pointerMove
  if (command === 'action') {
    const seq = args[0] as { actions?: Array<{ type: string; x?: number; y?: number }> } | undefined
    const move = seq?.actions?.find((a) => a.type === 'pointerMove')
    if (move?.x !== undefined) {
      return `${action.class}.${action.method}(${move.x}, ${move.y})`
    }
    return `${action.class}.${action.method}()`
  }

  // Fall back to selector from params when the command takes no positional args
  const firstArg = args[0] !== undefined ? args[0] : params?.selector
  if (firstArg === undefined) {
    return `${action.class}.${action.method}()`
  }
  const label = String(firstArg).slice(0, 80)
  return `${action.class}.${action.method}("${label}")`
}
