import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureMask, configureInputMasking } from '@wdio/devtools-core'
import type { CommandLog, NightwatchBrowser } from '../src/types.js'
import type * as Utils from '../src/helpers/utils.js'

const { getCallSourceFromStack } = vi.hoisted(() => ({
  getCallSourceFromStack: vi.fn()
}))
vi.mock('../src/helpers/utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Utils>()),
  getCallSourceFromStack
}))

import { NightwatchDevToolsPlugin } from '../src/index.js'
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
  return { capturer, sent, typed, setValue }
}

describe('Nightwatch page mask policy', () => {
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

  it('sets the run’s policy from the plugin options', () => {
    new NightwatchDevToolsPlugin({
      maskInputs: false,
      maskSelectors: ['.iban']
    })
    expect(captureMask()).toEqual({ inputs: false, selectors: ['.iban'] })
    new NightwatchDevToolsPlugin({})
    expect(captureMask()).toEqual({ inputs: true, selectors: [] })
  })

  it('keeps what setValue typed on its row, password included', () => {
    const { capturer, sent, typed, setValue } = setup()
    setValue('#username', 'tomsmith')
    setValue('#password', 'S3cret pass')

    expect(typed).toEqual([
      ['#username', 'tomsmith'],
      ['#password', 'S3cret pass']
    ])
    expect(capturer.commandsLog.map((row) => row.args)).toEqual([
      ['#username', 'tomsmith'],
      ['#password', 'S3cret pass']
    ])
    expect(sent.map((row) => row.args)).toEqual([
      ['#username', 'tomsmith'],
      ['#password', 'S3cret pass']
    ])
  })
})
