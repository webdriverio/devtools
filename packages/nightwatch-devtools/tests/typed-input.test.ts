import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureSecretRedaction, redactSecrets } from '@wdio/devtools-core'
import { FIELD_TYPE_SCRIPT } from '@wdio/devtools-shared'

import type { NightwatchBrowser } from '../src/types.js'

const { webdriverExecute } = vi.hoisted(() => ({
  webdriverExecute: vi.fn()
}))
vi.mock('../src/helpers/webdriverHttp.js', () => ({ webdriverExecute }))

import {
  observeTyping,
  readFieldBeforeTyping,
  recordedTypingArgs
} from '../src/helpers/typed-input.js'

const SECRET = 'SuperSecretPassword!'

/** A browser whose queue runs a perform callback and then the command queued after it, in order. */
function queuedBrowser() {
  const queue: (() => unknown)[] = []
  const browser = {
    perform: vi.fn((callback: () => unknown) => queue.push(callback))
  } as unknown as NightwatchBrowser & { perform: ReturnType<typeof vi.fn> }
  const run = async (typed: () => unknown) => {
    queue.push(typed)
    for (const step of queue.splice(0)) {
      await step()
    }
  }
  return { browser, run }
}

describe('readFieldBeforeTyping', () => {
  afterEach(() => {
    webdriverExecute.mockReset()
    configureSecretRedaction({ maskInputs: false })
    configureSecretRedaction()
  })

  it('reads the field in the queue before setValue types, so its row is captured redacted', async () => {
    webdriverExecute.mockResolvedValue('password')
    const { browser, run } = queuedBrowser()
    readFieldBeforeTyping(browser, 'setValue', ['#password', SECRET], false)
    let row: unknown
    await run(() => {
      row = redactSecrets({ command: 'setValue', args: ['#password', SECRET] })
    })
    expect(webdriverExecute).toHaveBeenCalledWith(browser, FIELD_TYPE_SCRIPT, [
      '#password',
      'css'
    ])
    expect(row).toEqual({ command: 'setValue', args: ['#password', '••••'] })
  })

  it('reads the (using, selector, value) form, an element definition’s strategy and the client’s useXpath', async () => {
    webdriverExecute.mockResolvedValue('password')
    const { browser, run } = queuedBrowser()
    const session = { isNativeAppSession: false }
    observeTyping(
      browser,
      {
        methodName: 'setValue',
        logArgs: ['css selector', '#password', SECRET]
      },
      session
    )
    observeTyping(
      browser,
      {
        methodName: 'sendKeys',
        logArgs: [{ selector: '#pin', locateStrategy: 'xpath' }, 'value-1']
      },
      session
    )
    observeTyping(browser, { methodName: 'useXpath', logArgs: [] }, session)
    observeTyping(
      browser,
      { methodName: 'updateValue', logArgs: ['//input[2]', 'value-2'] },
      session
    )
    observeTyping(
      browser,
      { methodName: 'setValue', logArgs: ['id', 'password', 'value-3'] },
      session
    )
    await run(() => undefined)
    expect(webdriverExecute.mock.calls.map(([, , args]) => args)).toEqual([
      ['#password', 'css'],
      ['#pin', 'xpath'],
      ['//input[2]', 'xpath']
    ])
    expect(redactSecrets(`typed ${SECRET}`)).toBe('typed ••••')
  })

  it('takes a bare selector as CSS unless the config sets use_xpath', async () => {
    webdriverExecute.mockResolvedValue('text')
    const { browser, run } = queuedBrowser()
    ;(browser as unknown as { options: object }).options = { use_xpath: true }
    readFieldBeforeTyping(browser, 'setValue', ['//input', 'value-4'], false)
    const plain = queuedBrowser()
    readFieldBeforeTyping(
      plain.browser,
      'setValue',
      ['input', 'value-5'],
      false
    )
    await run(() => undefined)
    await plain.run(() => undefined)
    expect(webdriverExecute.mock.calls.map(([, , args]) => args)).toEqual([
      ['//input', 'xpath'],
      ['input', 'css']
    ])
  })

  it('queues nothing for another command, a short value, a native app or with input masking off', () => {
    const { browser } = queuedBrowser()
    readFieldBeforeTyping(browser, 'click', ['#login'], false)
    readFieldBeforeTyping(browser, 'setValue', ['#pin', 'abc'], false)
    readFieldBeforeTyping(browser, 'setValue', ['#password', SECRET], true)
    configureSecretRedaction({ maskInputs: false })
    readFieldBeforeTyping(browser, 'setValue', ['#password', SECRET], false)
    expect(browser.perform).not.toHaveBeenCalled()
  })
})

describe('recordedTypingArgs', () => {
  afterEach(() => {
    webdriverExecute.mockReset()
    configureSecretRedaction({ maskInputs: false })
    configureSecretRedaction()
  })

  it('records a password typed in chunks joined, so its row is redacted whole while Nightwatch keeps the parts', async () => {
    webdriverExecute.mockResolvedValue('password')
    const { browser, run } = queuedBrowser()
    const logArgs = ['#password', ['SuperSecret', 'Password!']]
    readFieldBeforeTyping(browser, 'setValue', logArgs, false)
    let row: unknown
    await run(() => {
      row = redactSecrets({
        command: 'setValue',
        args: recordedTypingArgs('setValue', logArgs)
      })
    })
    expect(row).toEqual({ command: 'setValue', args: ['#password', '••••'] })
    expect(logArgs).toEqual(['#password', ['SuperSecret', 'Password!']])
  })

  it('joins the text of the (using, selector, value) form and leaves other commands alone', () => {
    expect(
      recordedTypingArgs('sendKeys', ['css selector', '#pin', ['ab', 'cd']])
    ).toEqual(['css selector', '#pin', 'abcd'])
    expect(recordedTypingArgs('execute', ['fn', ['ab', 'cd']])).toEqual([
      'fn',
      ['ab', 'cd']
    ])
  })
})
