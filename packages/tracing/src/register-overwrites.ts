import { BROWSER_COMMAND_LIST, ELEMENT_COMMAND_LIST } from './action-mapping.js'
import type { TraceRecorder } from './recorder.js'

const TRACE_INSTALLED = Symbol.for('wdio-trace-overwrites-installed')

export function registerOverwrites(
  browser: WebdriverIO.Browser,
  recorder: TraceRecorder
): void {
  if ((browser as any)[TRACE_INSTALLED]) return
  ;(browser as any)[TRACE_INSTALLED] = true

  for (const name of BROWSER_COMMAND_LIST) {
    ;(browser as any).overwriteCommand(
      name,
      async function (
        this: WebdriverIO.Browser,
        origFn: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) {
        return recorder.wrapAction(name, args, undefined, () => origFn(...args))
      }
    )
  }

  for (const name of ELEMENT_COMMAND_LIST) {
    ;(browser as any).overwriteCommand(
      name,
      async function (
        this: WebdriverIO.Element,
        origFn: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) {
        const selector =
          typeof this.selector === 'string' ? this.selector : undefined
        return recorder.wrapAction(name, args, selector, () => origFn(...args))
      },
      true
    )
  }

  // browser.action() returns an ActionSequence synchronously — the wrapper must
  // also be synchronous so that .move().down()... chaining keeps working.
  // Only .perform() is replaced with an async traced version.
  ;(browser as any).overwriteCommand(
    'action',
    function (
      this: WebdriverIO.Browser,
      origFn: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) {
      const sequence = origFn(...args) as any
      const origPerform = sequence.perform.bind(sequence) as () => Promise<void>
      sequence.perform = async () => {
        const actionDef = sequence.toJSON()
        return recorder.wrapAction('action', [actionDef], undefined, () =>
          origPerform()
        )
      }
      return sequence
    }
  )
}
