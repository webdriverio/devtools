import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceCommand } from '@wdio/devtools-shared'
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

const NOW = 1_000_000

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** What the dashboard ends up showing: every frame folded the way the app folds them. */
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

function setup() {
  const capturer = new SessionCapturer({})
  const frames: [string, unknown][] = []
  vi.spyOn(capturer, 'sendUpstream').mockImplementation((scope, data) => {
    frames.push([scope, data])
  })
  const shots = [deferred<string | null>(), deferred<string | null>()]
  let shot = 0
  vi.spyOn(capturer, 'takeScreenshotViaHttp').mockImplementation(
    () => shots[shot++].promise
  )
  const testManager = {
    detectTestBoundary: vi.fn(() => ''),
    startTestIfPending: vi.fn(),
    runningTest: vi.fn(() => undefined)
  } as unknown as TestManager
  const proxy = new BrowserProxy(capturer, testManager, () => ({
    uid: 'test-1'
  }))
  const browser = {
    getText: (...args: unknown[]) => {
      ;(args[args.length - 1] as (r: unknown) => void)({ value: 'Welcome' })
      return undefined
    }
  } as unknown as NightwatchBrowser
  proxy.wrapBrowserCommands(browser)
  const getText = () =>
    (browser as unknown as { getText: (s: string) => void }).getText('#flash')
  /** A node:assert row, captured the way `assertCapture.ts` captures one. */
  const assertRow = () => {
    void capturer.captureCommand(
      'equal',
      ['Welcome', 'Welcome'],
      true,
      undefined,
      { testUid: 'test-1', timestamp: NOW }
    )
    capturer.sendCommand(capturer.commandsLog[capturer.commandsLog.length - 1])
  }
  return { capturer, frames, shots, getText, assertRow }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Nightwatch row ids', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    getCallSourceFromStack.mockReturnValue({
      filePath: '/tests/spec.js',
      callSource: '/tests/spec.js:9'
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies a late screenshot to its read, not to an assertion stamped in the same millisecond', async () => {
    const { frames, shots, getText, assertRow } = setup()
    getText()
    assertRow()
    shots[0].resolve('shot.png')
    await flush()

    const rows = dashboardRows(frames)
    expect(rows.map((r) => r.command)).toEqual(['getText', 'equal'])
    expect(rows[0].screenshot).toBe('shot.png')
    expect(rows[1].screenshot).toBeUndefined()
  })

  it('keeps the row id across a retry, so the dashboard updates the row it shows', async () => {
    const { capturer, frames, getText } = setup()
    getText()
    const firstId = capturer.commandsLog[0].id
    expect(firstId).toBeTypeOf('number')
    getText()

    expect(capturer.commandsLog).toHaveLength(1)
    expect(capturer.commandsLog[0].id).toBe(firstId)
    expect(dashboardRows(frames)).toHaveLength(1)
  })

  it("sends nothing for a superseded row's late screenshot", async () => {
    const { frames, shots, getText } = setup()
    getText()
    getText()
    const sent = frames.length
    shots[0].resolve('stale.png')
    await flush()

    expect(frames).toHaveLength(sent)
    shots[1].resolve('fresh.png')
    await flush()
    expect(dashboardRows(frames).map((r) => r.screenshot)).toEqual([
      'fresh.png'
    ])
  })

  // The backend keeps the parent run's rows when a rerun child connects, and both processes start counting afresh.
  it("leaves another process's row alone when a late screenshot lands", async () => {
    const parent = setup()
    parent.getText()
    parent.shots[0].resolve('parent.png')
    await flush()
    const child = setup()
    child.getText()
    child.shots[0].resolve('child.png')
    await flush()

    const rows = dashboardRows([...parent.frames, ...child.frames])
    expect(rows.map((r) => r.screenshot)).toEqual(['parent.png', 'child.png'])
  })
})
