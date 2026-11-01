import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nestCommands, replaceCommand } from '@wdio/devtools-shared'
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

type Callback = (result: unknown) => void
type Condition = (this: unknown) => Promise<boolean> | boolean

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** The dashboard's rows: every frame folded the way the app folds them. */
function dashboardRows(frames: [string, unknown][]): CommandLog[] {
  let rows: CommandLog[] = []
  for (const [scope, data] of frames) {
    if (scope === 'commands') {
      rows = [...rows, ...(data as CommandLog[])]
    } else if (scope === 'replaceCommand') {
      const { oldTimestamp, command } = data as {
        oldTimestamp: number
        command: CommandLog
      }
      rows = replaceCommand(rows, oldTimestamp, command)
    }
  }
  return rows
}

/** The first frame each row id was sent in. */
function firstSent(frames: [string, unknown][]): Map<number, CommandLog> {
  const first = new Map<number, CommandLog>()
  for (const [scope, data] of frames) {
    const rows =
      scope === 'commands'
        ? (data as CommandLog[])
        : scope === 'replaceCommand'
          ? [(data as { command: CommandLog }).command]
          : []
    for (const row of rows) {
      if (typeof row.id === 'number' && !first.has(row.id)) {
        first.set(row.id, { ...row })
      }
    }
  }
  return first
}

/**
 * A browser shaped like Nightwatch's at the plugin's seam: each command answers
 * its trailing callback later, off a timer, and `waitUntil` calls its condition
 * from its own poll loop rather than from the call that issued it.
 */
function makeBrowser(text: Record<string, string>) {
  const api: Record<string, unknown> = {}
  const later = (cb: Callback, result: unknown, ms = 1) =>
    new Promise((resolve) =>
      setTimeout(() => {
        cb(result)
        resolve((result as { value?: unknown })?.value)
      }, ms)
    )
  api.getText = (selector: string, cb: Callback) =>
    later(cb, { value: text[selector] ?? '' })
  api.waitUntil = (condition: Condition, ...rest: unknown[]) => {
    const cb = rest.find((a) => typeof a === 'function') as Callback
    return (async () => {
      await tick()
      for (let poll = 0; poll < 20; poll++) {
        if (await condition.call(api)) {
          cb({ value: true })
          return true
        }
        await tick(2)
      }
      const error = new Error('Wait timed out')
      cb({ value: null, error })
      throw error
    })()
  }
  api.waitForElementVisible = (_selector: string, ...rest: unknown[]) =>
    later(rest[rest.length - 1] as Callback, { value: null, status: -1 }, 5)
  api.assert = {
    textContains: (..._args: unknown[]) => Promise.resolve(true)
  }
  return api as unknown as NightwatchBrowser & {
    getText(selector: string): Promise<string>
    waitUntil(condition: Condition, ...rest: unknown[]): Promise<boolean>
    waitForElementVisible(selector: string, timeout: number): Promise<unknown>
    assert: { textContains(selector: string, text: string): Promise<boolean> }
  }
}

function setup(
  text: Record<string, string> = {},
  adjust?: (browser: ReturnType<typeof makeBrowser>) => void
) {
  const capturer = new SessionCapturer({})
  const frames: [string, unknown][] = []
  vi.spyOn(capturer, 'sendUpstream').mockImplementation((scope, data) => {
    frames.push([scope, JSON.parse(JSON.stringify(data))])
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
  const browser = makeBrowser(text)
  adjust?.(browser)
  proxy.wrapBrowserCommands(browser)
  return { browser, frames, proxy }
}

const byCommand = (rows: CommandLog[], command: string, selector?: string) =>
  rows.filter(
    (r) =>
      r.command === command &&
      (selector === undefined || r.args?.[0] === selector)
  )

describe('Nightwatch wait rows', () => {
  beforeEach(() => {
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('nests the reads a waitUntil condition issues under the wait, folded per distinct call', async () => {
    const { browser, frames } = setup({ '#flash': 'Welcome', h2: 'Secure' })
    let polls = 0
    await browser.waitUntil(async () => {
      polls++
      const flash = await browser.getText('#flash')
      const heading = await browser.getText('h2')
      return polls > 2 && flash !== '' && heading !== ''
    })

    const rows = dashboardRows(frames)
    const [wait] = byCommand(rows, 'waitUntil')
    expect(typeof wait.id).toBe('number')
    expect(wait.error).toBeUndefined()
    const reads = byCommand(rows, 'getText')
    expect(reads.map((r) => r.args?.[0])).toEqual(['#flash', 'h2'])
    expect(reads.map((r) => r.parentId)).toEqual([wait.id, wait.id])
    expect(nestCommands(rows)).toHaveLength(1)
    for (const read of reads) {
      expect(read.timestamp).toBeLessThanOrEqual(wait.timestamp)
    }
  })

  it('sends the wait running, before anything its condition issued, and ends it by id at completion', async () => {
    const { browser, frames } = setup({ '#flash': 'Welcome' })
    await browser.waitUntil(
      async () => (await browser.getText('#flash')) !== '',
      2000
    )

    const rows = dashboardRows(frames)
    const [wait] = byCommand(rows, 'waitUntil')
    const firstFrame = frames.findIndex(
      ([scope, data]) =>
        scope === 'commands' &&
        (data as CommandLog[]).some((r) => r.id === wait.id)
    )
    const firstChild = frames.findIndex(
      ([scope, data]) =>
        scope === 'commands' &&
        (data as CommandLog[]).some((r) => r.parentId === wait.id)
    )
    expect(firstFrame).toBeGreaterThanOrEqual(0)
    expect(firstFrame).toBeLessThan(firstChild)
    const running = firstSent(frames).get(wait.id!)!
    expect(running.timestamp).toBe(running.startTime)
    expect(running.result).toBeUndefined()
    expect(running.error).toBeUndefined()
    expect(wait.startTime).toBe(running.startTime)
    expect(wait.timestamp).toBeGreaterThan(running.startTime!)
    expect(rows.filter((r) => r.id === wait.id)).toHaveLength(1)
  })

  it('nests a wait issued inside another wait, and its reads under the inner one', async () => {
    const { browser, frames } = setup({ '#flash': 'Welcome', h2: 'Secure' })
    await browser.waitUntil(async () => {
      await browser.waitUntil(
        async () => (await browser.getText('#flash')) !== '',
        1000
      )
      return (await browser.getText('h2')) !== ''
    }, 2000)

    const rows = dashboardRows(frames)
    const [outer, inner] = byCommand(rows, 'waitUntil')
    expect(inner.parentId).toBe(outer.id)
    expect(byCommand(rows, 'getText', '#flash')[0].parentId).toBe(inner.id)
    expect(byCommand(rows, 'getText', 'h2')[0].parentId).toBe(outer.id)
    const [root] = nestCommands(rows)
    expect(root.command.id).toBe(outer.id)
    expect(root.children.map((c) => c.command.command)).toEqual([
      'waitUntil',
      'getText'
    ])
  })

  it('leaves a command the condition did not issue unparented, though it ran while the wait was open', async () => {
    const { browser, frames } = setup({ '#flash': 'Welcome', '#other': 'x' })
    const outside = tick(3).then(() => browser.getText('#other'))
    let polls = 0
    await browser.waitUntil(async () => {
      polls++
      await browser.getText('#flash')
      return polls > 3
    }, 2000)
    await outside
    await browser.getText('#other')

    const rows = dashboardRows(frames)
    const [wait] = byCommand(rows, 'waitUntil')
    const others = byCommand(rows, 'getText', '#other')
    expect(others.length).toBeGreaterThan(0)
    expect(others[0].startTime).toBeGreaterThanOrEqual(wait.startTime!)
    expect(others.every((r) => r.parentId === undefined)).toBe(true)
    expect(byCommand(rows, 'getText', '#flash')[0].parentId).toBe(wait.id)
  })

  it('marks a timed-out waitForElementVisible failed, from the false Nightwatch hands its callback', async () => {
    const { browser, frames } = setup()
    await browser.waitForElementVisible('#missing', 300)

    const rows = dashboardRows(frames)
    const [wait] = byCommand(rows, 'waitForElementVisible')
    expect(wait.result).toBe(false)
    expect(wait.error).toMatchObject({
      message: 'waitForElementVisible timed out waiting for #missing'
    })
    expect(wait.selector).toBe('#missing')
    const running = firstSent(frames).get(wait.id!)!
    expect(running.error).toBeUndefined()
    expect(running.timestamp).toBe(running.startTime)
  })

  it('carries the error of a waitUntil that times out', async () => {
    const { browser, frames } = setup({ '#flash': '' })
    await expect(
      browser.waitUntil(
        async () => (await browser.getText('#flash')) !== '',
        50
      )
    ).rejects.toThrow('Wait timed out')

    const [wait] = byCommand(dashboardRows(frames), 'waitUntil')
    expect(wait.error).toMatchObject({ message: 'Wait timed out' })
  })

  it('closes a wait the aborted queue never ran as not run, never as passed', async () => {
    // An earlier assert failed, so Nightwatch drops the chained wait: its condition and callback never run.
    const { browser, frames, proxy } = setup({}, (api) => {
      api.waitUntil = () => new Promise<boolean>(() => {})
    })
    void browser.waitUntil(async () => true, 2000)
    await tick(5)
    const [running] = byCommand(dashboardRows(frames), 'waitUntil')
    expect(running.error).toBeUndefined()

    proxy.closeUnrunWaits()

    const [wait] = byCommand(dashboardRows(frames), 'waitUntil')
    expect(wait.id).toBe(running.id)
    expect(wait.error).toMatchObject({
      name: 'NotRunError',
      message:
        'waitUntil did not run: the test ended before Nightwatch reached it'
    })
    expect(wait.timestamp).toBe(wait.startTime)
    const sent = frames.length
    proxy.closeUnrunWaits()
    expect(frames).toHaveLength(sent)
  })

  it('finds a closing wait among the newest rows, not by reading the run from its start', () => {
    const capturer = new SessionCapturer({})
    vi.spyOn(capturer, 'sendUpstream').mockImplementation(() => {})
    const rows: CommandLog[] = Array.from({ length: 10_000 }, (_, i) => ({
      command: 'click',
      args: [],
      timestamp: i
    }))
    let reads = 0
    capturer.commandsLog = new Proxy(rows, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          reads++
        }
        return Reflect.get(target, prop, receiver)
      }
    })
    const wait = capturer.openCommand('waitUntil', [], { startTime: 20_000 })
    reads = 0
    capturer.closeCommand(wait, true, undefined, 20_100)
    expect(reads).toBeLessThan(100)
    expect(rows.at(-1)).toBe(wait)
  })

  it('leaves native assertions as they were: buffered, unparented, after the wait', async () => {
    const { browser, frames, proxy } = setup({ '#flash': 'Welcome' })
    await browser.waitUntil(
      async () => (await browser.getText('#flash')) !== '',
      2000
    )
    await browser.assert.textContains('#flash', 'Welcome')

    const streamed = dashboardRows(frames)
    expect(streamed.map((r) => r.command)).toEqual(['waitUntil', 'getText'])
    const [call] = proxy.drainNativeAssertCalls()
    expect(call.method).toBe('textContains')
    expect(call.entry?.parentId).toBeUndefined()
    const [wait] = byCommand(streamed, 'waitUntil')
    expect(call.entry!.sequence!).toBeGreaterThan(wait.sequence!)
  })
})
