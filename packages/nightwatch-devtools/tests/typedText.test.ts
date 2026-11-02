import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTypedValues,
  configureInputMasking,
  scrubTypedText
} from '@wdio/devtools-core'
import { MASKED_VALUE } from '@wdio/devtools-shared'
import type { CommandLog, NightwatchBrowser } from '../src/types.js'
import type * as Utils from '../src/helpers/utils.js'

const { getCallSourceFromStack } = vi.hoisted(() => ({
  getCallSourceFromStack: vi.fn()
}))
vi.mock('../src/helpers/utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  getCallSourceFromStack
}))

import { BrowserProxy } from '../src/helpers/browserProxy.js'
import type { TestManager } from '../src/helpers/testManager.js'
import { SessionCapturer } from '../src/session.js'

/** A browser whose `setValue` records what the driver would have typed and answers at once. */
function setup() {
  const capturer = new SessionCapturer({})
  const sent: CommandLog[] = []
  vi.spyOn(capturer, 'sendUpstream').mockImplementation((scope, data) => {
    if (scope === 'commands') {
      sent.push(...(data as CommandLog[]))
    }
  })
  vi.spyOn(capturer, 'takeScreenshotViaHttp').mockResolvedValue(null)
  const testManager = {
    detectTestBoundary: vi.fn(() => ''),
    startTestIfPending: vi.fn(),
    runningTest: vi.fn(() => undefined)
  } as unknown as TestManager
  const proxy = new BrowserProxy(capturer, testManager, () => ({
    uid: 'test-1'
  }))
  const typed: unknown[][] = []
  const browser = {
    setValue: (...args: unknown[]) => {
      typed.push(args.slice(0, -1))
      ;(args[args.length - 1] as (r: unknown) => void)({ value: null })
      return undefined
    }
  } as unknown as NightwatchBrowser
  proxy.wrapBrowserCommands(browser)
  const setValue = (selector: string, value: string) =>
    (
      browser as unknown as { setValue: (s: string, v: string) => void }
    ).setValue(selector, value)
  return { capturer, sent, typed, setValue, proxy }
}

describe('Nightwatch typed text', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
  })
  afterEach(() => {
    configureInputMasking()
    vi.restoreAllMocks()
  })

  it('types the real text and records it masked, after its selector', () => {
    configureInputMasking()
    const { capturer, sent, typed, setValue } = setup()
    setValue('#username', 'tomsmith')
    setValue('#password', 'S3cret pass')

    expect(typed).toEqual([
      ['#username', 'tomsmith'],
      ['#password', 'S3cret pass']
    ])
    expect(capturer.commandsLog.map((row) => row.args)).toEqual([
      ['#username', MASKED_VALUE],
      ['#password', MASKED_VALUE]
    ])
    expect(JSON.stringify(sent)).not.toMatch(/tomsmith|S3cret/)
  })

  it('records the typed text with maskInputs: false', () => {
    configureInputMasking({ maskInputs: false })
    const { capturer, setValue } = setup()
    setValue('#password', 'S3cret pass')
    expect(capturer.commandsLog[0].args).toEqual(['#password', 'S3cret pass'])
  })

  it('forgets what was typed when the next test unit starts', () => {
    configureInputMasking()
    clearTypedValues()
    const { proxy, setValue } = setup()
    setValue('#password', 'S3cret pass')
    expect(scrubTypedText('S3cret pass')).not.toBe('S3cret pass')
    proxy.resetTestTracking()
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
  })

  it('masks text typed into a prompt', () => {
    configureInputMasking()
    const { capturer, proxy } = setup()
    const browser = {
      setAlertText: (...args: unknown[]) => {
        ;(args[args.length - 1] as (r: unknown) => void)({ value: null })
      }
    } as unknown as NightwatchBrowser
    proxy.wrapBrowserCommands(browser)
    ;(browser as unknown as { setAlertText: (v: string) => void }).setAlertText(
      'S3cret pass'
    )
    expect(capturer.commandsLog.at(-1)?.args).toEqual([MASKED_VALUE])
  })
})
