import assert from 'node:assert'
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import { replaceCommand, type CommandLog } from '@wdio/devtools-shared'

import DevToolsHookService from '../src/index.js'
import { SessionCapturer } from '../src/session.js'

// A command issued from the spec carries a user frame on its stack; one WDIO issues internally does not.
const stack = vi.hoisted(() => {
  const user = {
    getFileName: () => '/test/specs/login.spec.ts',
    getLineNumber: () => 7,
    getColumnNumber: () => 3
  }
  return { user, frames: [user] as unknown[] }
})
vi.mock('stack-trace', () => ({ parse: () => stack.frames }))
vi.mock('ws')
vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn().mockRejectedValue(new Error('none')),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined)
  }
}))
vi.mock('../src/screencast-lifecycle.js', () => ({
  ScreencastLifecycle: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      markStart: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined)
    }
  })
}))
vi.mock('../src/intercepted-network.js', () => ({
  InterceptedNetwork: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined)
    }
  })
}))

const browser = {
  isBidi: false,
  sessionId: 's1',
  options: {},
  capabilities: { browserName: 'chrome' },
  takeScreenshot: vi.fn().mockResolvedValue('SHOT'),
  execute: vi.fn().mockResolvedValue(undefined),
  scriptAddPreloadScript: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  emit: vi.fn(),
  addCommand: vi.fn()
} as unknown as WebdriverIO.Browser

// before() wires node:assert capture; restore the real methods afterwards.
const patchedAssert = assert as unknown as Record<string | symbol, unknown>
const originalAssert = Object.fromEntries(
  TRACKED_ASSERT_METHODS.map((method) => [method, patchedAssert[method]])
)
afterAll(() => {
  delete patchedAssert[ASSERT_PATCHED_SYMBOL]
  Object.assign(patchedAssert, originalAssert)
})

type Frame = [string, unknown]
let sent: Frame[] = []

/** The rows as the dashboard holds them once every replacement has been applied. */
const rows = () =>
  sent.reduce<CommandLog[]>((list, [scope, data]) => {
    if (scope === 'commands') {
      return [...list, ...(data as CommandLog[])]
    }
    if (scope === 'replaceCommand') {
      const { oldTimestamp, command } = data as {
        oldTimestamp: number
        command: CommandLog
      }
      return replaceCommand(list, oldTimestamp, command)
    }
    return list
  }, [])

const firstSend = (id: number) =>
  sent
    .filter(([scope]) => scope === 'commands')
    .flatMap(([, data]) => data as CommandLog[])
    .find((row) => row.id === id)

let service: DevToolsHookService

const before = (command: string, args: unknown[] = [], user = true) => {
  stack.frames = user ? [stack.user] : []
  return service.beforeCommand(command, args as string[])
}
const after = (
  command: string,
  args: unknown[] = [],
  result?: unknown,
  error?: Error
) => service.afterCommand(command as never, args, result, error)

/** One command a WDIO caller issues: its hooks around whatever it issues itself. */
async function command(
  name: string,
  args: unknown[] = [],
  result?: unknown,
  { user = true, inner = async () => {} } = {}
) {
  await before(name, args, user)
  await inner()
  await after(name, args, result)
}

/** An element read as WDIO issues it: the hooks fire twice, the second from inside the element wrapper. */
async function elementRead(name: string, result: unknown, user = true) {
  await command(name, [], result, {
    user,
    inner: () => command(name, [], result, { user: false })
  })
}

/**
 * An element wait as WDIO runs it: its own doubled hooks, a `waitUntil` polling `isExisting`, then a re-validation.
 * WDIO's first poll runs inside the spec's own call, so it can carry the spec frame; every later one runs from a timer.
 */
async function elementWait(
  polls: boolean[],
  error?: Error,
  firstPollFromSpec = false
) {
  await before('waitForExist', [], true)
  await before('waitForExist', [{ timeout: 300 }], false)
  await before('waitUntil', [], true)
  await before('waitUntil', [null, { timeout: 300 }], false)
  for (const [i, found] of polls.entries()) {
    await elementRead('isExisting', found, firstPollFromSpec && i === 0)
  }
  await after('waitUntil', [], undefined, error)
  await after('waitUntil', [null, { timeout: 300 }], undefined, error)
  // WDIO re-validates the element it found once the polling ends.
  if (!error) {
    await command('getElementTagName', ['el-1'], 'div', { user: false })
  }
  await after('waitForExist', [{ timeout: 300 }], !error, error)
  await after('waitForExist', [], !error, error)
}

describe('a wait is one row holding what it issued', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    sent = []
    vi.spyOn(SessionCapturer.prototype, 'sendUpstream').mockImplementation(
      (scope: string, data: unknown) => {
        sent.push([scope, data])
      }
    )
    service = new DevToolsHookService()
    await service.before({} as never, [], browser)
    sent = []
  })

  it('nests both reads of a waitUntil condition under one wait row', async () => {
    const condition = async () => {
      await command('$', ['#flash'], { 'element-6066': 'el-1' })
      await elementRead('getText', 'Welcome')
      await command('$', ['h2'], { 'element-6066': 'el-2' })
      await elementRead('getText', 'Secure Area')
    }
    await command('waitUntil', [null, { timeout: 2000 }], true, {
      inner: async () => {
        await condition()
        await condition()
      }
    })

    const [wait, ...issued] = rows()
    expect(wait).toMatchObject({ command: 'waitUntil', result: true })
    expect(wait.parentId).toBeUndefined()
    expect(issued.map((r) => [r.command, r.selector ?? r.args[0]])).toEqual([
      ['$', '#flash'],
      ['getText', '#flash'],
      ['$', 'h2'],
      ['getText', 'h2']
    ])
    expect(issued.every((r) => r.parentId === wait.id)).toBe(true)
    // Sent running when it started, so the reads had a row to nest under while it ran.
    expect(firstSend(wait.id!)).toMatchObject({
      timestamp: wait.startTime,
      startTime: wait.startTime
    })
    expect(firstSend(wait.id!)?.result).toBeUndefined()
    expect(wait.timestamp).toBeGreaterThanOrEqual(issued.at(-1)!.timestamp)
  })

  it("nests an element wait's polls under it, folded into one row", async () => {
    await command('$', ['#flash'], { 'element-6066': 'el-1' })
    await elementWait([false, false, true])

    const [, wait, ...issued] = rows()
    expect(wait).toMatchObject({ command: 'waitForExist', selector: '#flash' })
    expect(issued).toHaveLength(1)
    expect(issued[0]).toMatchObject({
      command: 'isExisting',
      result: true,
      parentId: wait.id
    })
  })

  // Regression: the first poll carried the spec's call site and the timer-driven ones none, so they split into two rows.
  it("folds an element wait's later polls into its first, which keeps the spec's call site", async () => {
    await command('$', ['#missing'], { 'element-6066': 'el-1' })
    await elementWait(
      [false, false, false],
      new Error('element ("#missing") still not existing after 300ms'),
      true
    )

    const wait = rows().find((r) => r.command === 'waitForExist')!
    const polls = rows().filter((r) => r.parentId === wait.id)
    expect(polls).toHaveLength(1)
    expect(polls[0].callSource).toContain('login.spec.ts')
  })

  it("carries a timed-out wait's error on its row", async () => {
    await command('$', ['#missing'], { 'element-6066': 'el-1' })
    const timeout = new Error(
      'element ("#missing") still not existing after 300ms'
    )
    await elementWait([false, false], timeout)

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(wait.error?.message).toBe(timeout.message)
    expect(wait.selector).toBe('#missing')
    expect(rows().filter((r) => r.parentId === wait.id)).toHaveLength(1)
  })

  it('nests a wait issued inside a waitUntil condition under it, and its polls under the inner wait', async () => {
    await command('waitUntil', [null, { timeout: 2000 }], true, {
      inner: async () => {
        await command('$', ['#flash'], { 'element-6066': 'el-1' })
        await elementWait([true])
        await elementRead('getText', 'Welcome')
      }
    })

    const all = rows()
    const outer = all.find((r) => r.command === 'waitUntil')!
    const inner = all.find((r) => r.command === 'waitForExist')!
    expect(inner.parentId).toBe(outer.id)
    expect(
      all.filter((r) => r.parentId === outer.id).map((r) => r.command)
    ).toEqual(['$', 'waitForExist', 'getText'])
    expect(
      all.filter((r) => r.parentId === inner.id).map((r) => r.command)
    ).toEqual(['isExisting'])
    // A row inside the condition after the inner wait still nests under the outer one.
    expect(all.find((r) => r.command === 'getText')?.parentId).toBe(outer.id)
  })

  it('keeps one row per distinct call when a condition re-runs a nested wait', async () => {
    await command('waitUntil', [null, { timeout: 2000 }], true, {
      inner: async () => {
        await elementWait([false])
        await elementWait([true])
      }
    })

    const all = rows()
    const outer = all.find((r) => r.command === 'waitUntil')!
    const inner = all.filter((r) => r.command === 'waitForExist')
    expect(inner).toHaveLength(1)
    expect(inner[0].parentId).toBe(outer.id)
    expect(all.filter((r) => r.parentId === inner[0].id)).toHaveLength(1)
  })

  // Regression: each outer poll reopened the nested wait with a later start, which the poll it kept then preceded.
  it("keeps a nested wait's first start across the outer polls", async () => {
    let clock = 1000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10))
    try {
      await command('waitUntil', [null, { timeout: 2000 }], true, {
        inner: async () => {
          await elementWait([false])
          await elementWait([true])
        }
      })
    } finally {
      now.mockRestore()
    }

    const sentInner = sent
      .flatMap(([scope, data]) =>
        scope === 'commands'
          ? (data as CommandLog[])
          : scope === 'replaceCommand'
            ? [(data as { command: CommandLog }).command]
            : []
      )
      .filter((r) => r.command === 'waitForExist')
    const first = sentInner[0].startTime
    expect(sentInner.length).toBeGreaterThan(2)
    expect(sentInner.every((r) => r.startTime === first)).toBe(true)
    const inner = rows().find((r) => r.command === 'waitForExist')!
    const poll = rows().find((r) => r.parentId === inner.id)!
    expect(inner.startTime).toBeLessThanOrEqual(poll.startTime!)
  })

  it('leaves commands outside a wait as top-level rows that hide what they issue', async () => {
    await command('click', [], undefined, {
      inner: () => command('elementClick', ['el-1'], undefined, { user: false })
    })
    await command('waitUntil', [null, {}], true, {
      inner: () => elementRead('getText', 'x')
    })
    await elementRead('getText', 'after')

    const all = rows()
    expect(all.map((r) => r.command)).toEqual([
      'click',
      'waitUntil',
      'getText',
      'getText'
    ])
    expect(all[0].parentId).toBeUndefined()
    expect(all[3].parentId).toBeUndefined()
    expect(all[3].result).toBe('after')
  })

  it('still folds an expect matcher outside a wait into its read', async () => {
    await command('waitUntil', [null, {}], true, {
      inner: () => elementRead('getText', 'x')
    })
    await command('$', ['#flash'], { 'element-6066': 'el-1' })
    await elementRead('getText', 'Hi')
    await service.afterAssertion({
      matcherName: 'toHaveText',
      expectedValue: 'Hi',
      result: { pass: true }
    } as never)

    const all = rows()
    expect(all.map((r) => r.command)).toEqual([
      'waitUntil',
      'getText',
      '$',
      'expect.toHaveText'
    ])
    expect(all[3].parentId).toBeUndefined()
  })

  it("does not fold a matcher into a read a wait's condition issued", async () => {
    await command('waitUntil', [null, {}], true, {
      inner: async () => {
        await elementRead('getText', 'Hi')
        await service.afterAssertion({
          matcherName: 'toHaveText',
          expectedValue: 'Hi',
          result: { pass: true }
        } as never)
      }
    })

    const read = rows().find((r) => r.command === 'getText')
    expect(read?.parentId).toBe(rows()[0].id)
  })
})
