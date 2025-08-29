import type { StackFrame } from 'stack-trace'

export function getBrowserObject (elem: WebdriverIO.Element | WebdriverIO.Browser): WebdriverIO.Browser {
  const elemObject = elem as WebdriverIO.Element
  return (elemObject as WebdriverIO.Element).parent ? getBrowserObject(elemObject.parent) : elem as WebdriverIO.Browser
}

/**
 * Heuristics to decide whether a command is a "user-facing" command.
 * - skip selector helpers ($, $$, shadow$, etc.)
 * - only include commands invoked from user test files (not node_modules)
 */
export function isUserCommand(command: string, stack: StackFrame[]): boolean {
    // skip selector helpers or internal "LocateNodes"
    if (command.startsWith('$') || command.includes('LocateNodes')) return false

    // check if stack contains at least one frame in a test file
    return stack.some(frame =>
        frame.getFileName() &&
        !frame.getFileName()!.includes('node_modules')
    )
}
