import assert from 'node:assert'
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll
} from 'vitest'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import { replaceCommand, type CommandLog } from '@wdio/devtools-shared'

import DevToolsHookService from '../src/index.js'
import { SessionCapturer } from '../src/session.js'
import { WaitRows } from '../src/wait-rows.js'
import { HooksInFlight } from '../src/command-stack.js'

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
      finalize: vi.fn().mockResolvedValue(undefined),
      attachTestVideo: vi.fn().mockResolvedValue(undefined)
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

  // WDIO's element wrapper fires the first hook with no arguments and the second with the spec's; the spec frame is
  // searched 40 frames deep, so the second can carry the spec's line as well.
  it.each([true, false])(
    "keeps an element's waitUntil one row whether or not its second hook carries the spec frame (%s)",
    async (secondFromSpec) => {
      const args = [async () => true, { timeout: 2000 }]
      await before('waitUntil', [], true)
      await before('waitUntil', args, secondFromSpec)
      await elementRead('getText', 'Welcome')
      await after('waitUntil', args, true)
      await after('waitUntil', [], true)

      const [wait, ...issued] = rows()
      expect(rows().filter((r) => r.command === 'waitUntil')).toHaveLength(1)
      expect(wait.parentId).toBeUndefined()
      expect(issued.map((r) => [r.command, r.parentId])).toEqual([
        ['getText', wait.id]
      ])
    }
  )

  it("nests an element waitUntil that is the first command of another element waitUntil's condition", async () => {
    const outerArgs = [async () => true, { timeout: 2000 }]
    const innerArgs = [async () => true, { timeout: 500 }]
    await before('waitUntil', [], true)
    await before('waitUntil', outerArgs, true)
    await before('waitUntil', [], true)
    await before('waitUntil', innerArgs, true)
    await elementRead('getText', 'Welcome')
    await after('waitUntil', innerArgs, true)
    await after('waitUntil', [], true)
    await after('waitUntil', outerArgs, true)
    await after('waitUntil', [], true)

    const [outer, inner, read] = rows()
    expect([outer.command, inner.command, read.command]).toEqual([
      'waitUntil',
      'waitUntil',
      'getText'
    ])
    expect(inner.parentId).toBe(outer.id)
    expect(read.parentId).toBe(inner.id)
  })

  it('nests a waitUntil that is the first command of a waitUntil condition', async () => {
    await command('waitUntil', [async () => true, { timeout: 2000 }], true, {
      inner: () =>
        command('waitUntil', [async () => true, { timeout: 500 }], true, {
          inner: () => elementRead('getText', 'Welcome')
        })
    })

    const [outer, inner, read] = rows()
    expect([outer.command, inner.command, read.command]).toEqual([
      'waitUntil',
      'waitUntil',
      'getText'
    ])
    expect(inner.parentId).toBe(outer.id)
    expect(read.parentId).toBe(inner.id)
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

/** WDIO's module-global `inCommandHook`: a command's hook is skipped while any other hook is still running. */
function wdioHookGate() {
  let inCommandHook = false
  return async (hook: () => Promise<void>) => {
    if (inCommandHook) {
      return
    }
    inCommandHook = true
    await hook()
    inCommandHook = false
  }
}

/** A poll's screenshot the test releases, holding that poll's afterCommand hook open until then. */
function heldScreenshot() {
  let release = () => {}
  vi.mocked(browser.takeScreenshot).mockReturnValueOnce(
    new Promise<string>((resolve) => (release = () => resolve('SHOT')))
  )
  return () => release()
}

const TIMEOUT = new Error('element ("#missing") still not existing after 300ms')

/** A closed row is stamped at its completion; a running one, or one only marked failed, still carries its start. */
const closed = (id: number) => {
  const row = rows().find((r) => r.id === id)
  return Boolean(row && row.timestamp > row.startTime!)
}

describe('a wait whose afterCommand WDIO skipped is closed when its test ends (#529)', () => {
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
    let clock = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10))
  })
  afterEach(() => {
    vi.mocked(Date.now).mockRestore()
  })

  const endTest = (error?: Error) =>
    service.afterTest(
      { file: '/test/specs/login.spec.ts', title: 't', fullTitle: 't' },
      undefined,
      { error, passed: !error } as never
    )

  /** An element wait's hooks up to its first poll, whose afterCommand then holds the gate on its screenshot. */
  async function elementWaitHeldInPoll(gated: ReturnType<typeof wdioHookGate>) {
    await gated(() => before('waitForExist', [], true))
    await gated(() => before('waitForExist', [{ timeout: 300 }], false))
    await gated(() => before('waitUntil', [], true))
    await gated(() => before('waitUntil', [null, { timeout: 300 }], false))
    await gated(() => before('isExisting', [], false))
    await gated(() => before('isExisting', [], false))
    // Wrapped, or awaiting this helper would wait for the held capture itself.
    const poll = (async () => {
      await gated(() => after('isExisting', [], false))
      await gated(() => after('isExisting', [], false))
    })()
    return { poll }
  }

  /** The element wait's own hooks firing as its timer rejects it. */
  async function elementWaitSettles(
    gated: ReturnType<typeof wdioHookGate>,
    error?: Error
  ) {
    await gated(() =>
      after('waitUntil', [null, { timeout: 300 }], undefined, error)
    )
    await gated(() => after('waitUntil', [], undefined, error))
    await gated(() => after('waitForExist', [{ timeout: 300 }], !error, error))
    await gated(() => after('waitForExist', [], !error, error))
  }

  it.each([
    ['before', true],
    ['after', false]
  ])(
    "carries an element wait's timeout when its test ends %s the held poll's capture finished",
    async (_order, endFirst) => {
      const gated = wdioHookGate()
      await command('$', ['#missing'], { 'element-6066': 'el-1' })
      const release = heldScreenshot()
      const { poll } = await elementWaitHeldInPoll(gated)
      await elementWaitSettles(gated, TIMEOUT)
      if (endFirst) {
        const ended = endTest(TIMEOUT)
        release()
        await Promise.all([ended, poll])
      } else {
        release()
        await poll
        await endTest(TIMEOUT)
      }

      const wait = rows().find((r) => r.command === 'waitForExist')!
      expect(closed(wait.id!)).toBe(true)
      expect(wait.error?.message).toBe(TIMEOUT.message)
      expect(wait.selector).toBe('#missing')
      expect(wait.parentId).toBeUndefined()
      expect(wait.startTime).toBeLessThanOrEqual(wait.timestamp)
    }
  )

  it("carries a top-level waitUntil's timeout", async () => {
    const gated = wdioHookGate()
    const timeout = new Error('waitUntil condition timed out after 300ms')
    const args = [async () => false, { timeout: 300 }]
    await gated(() => before('waitUntil', args, true))
    await gated(() => before('getText', [], true))
    const release = heldScreenshot()
    const poll = gated(() => after('getText', [], 'Welcome'))
    await gated(() => after('waitUntil', args, undefined, timeout))
    const ended = endTest(timeout)
    release()
    await Promise.all([ended, poll])

    const wait = rows().find((r) => r.command === 'waitUntil')!
    expect(closed(wait.id!)).toBe(true)
    expect(wait.error?.message).toBe(timeout.message)
    expect(rows().find((r) => r.command === 'getText')?.parentId).toBe(wait.id)
  })

  it('closes a nested wait before the wait whose condition issued it, both with the timeout', async () => {
    const gated = wdioHookGate()
    const outerArgs = [async () => false, { timeout: 2000 }]
    await gated(() => before('waitUntil', outerArgs, true))
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated, TIMEOUT)
    await gated(() => after('waitUntil', outerArgs, undefined, TIMEOUT))
    const ended = endTest(TIMEOUT)
    release()
    await Promise.all([ended, poll])

    const outer = rows().find((r) => r.command === 'waitUntil')!
    const inner = rows().find((r) => r.command === 'waitForExist')!
    expect(inner.parentId).toBe(outer.id)
    expect([outer.error?.message, inner.error?.message]).toEqual([
      TIMEOUT.message,
      TIMEOUT.message
    ])
    const closes = sent
      .filter(([scope]) => scope === 'replaceCommand')
      .map(([, data]) => (data as { command: CommandLog }).command.id)
    expect(closes.indexOf(inner.id)).toBeLessThan(closes.lastIndexOf(outer.id))
  })

  it('closes a wait as passed when its afterCommand was skipped and its test passed', async () => {
    const gated = wdioHookGate()
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated)
    release()
    await poll
    await endTest()

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(closed(wait.id!)).toBe(true)
    expect(wait.error).toBeUndefined()
  })

  it('closes it when a Cucumber step ends, with the step error', async () => {
    const gated = wdioHookGate()
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated, TIMEOUT)
    const ended = service.afterStep(undefined, undefined, {
      error: TIMEOUT.message
    })
    release()
    await Promise.all([ended, poll])

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(closed(wait.id!)).toBe(true)
    expect(wait.error?.message).toBe(TIMEOUT.message)
  })

  it("closes it with a step's string error as the runner reported it, ANSI stripped and with no stack of the service's", async () => {
    const gated = wdioHookGate()
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated, TIMEOUT)
    const ended = service.afterStep(undefined, undefined, {
      error: `\u001b[31m${TIMEOUT.message}\u001b[39m`
    })
    release()
    await Promise.all([ended, poll])

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(wait.error).toEqual({ name: 'Error', message: TIMEOUT.message })
  })

  it('leaves an assertion failure on its own row and closes the wait without it', async () => {
    const gated = wdioHookGate()
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated)
    release()
    await poll
    await endTest(new assert.AssertionError({ message: 'title differs' }))

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(closed(wait.id!)).toBe(true)
    expect(wait.error).toBeUndefined()
  })

  it("lets the next test's first command keep its row once a poll's capture outlived the timed-out wait", async () => {
    const gated = wdioHookGate()
    const release = heldScreenshot()
    const { poll } = await elementWaitHeldInPoll(gated)
    await elementWaitSettles(gated, TIMEOUT)
    // The capture answers later than the test ends; the next test starts as soon as afterTest resolves.
    setTimeout(release, 20)
    await endTest(TIMEOUT)
    await gated(() => before('url', ['/broken'], true))
    await gated(() =>
      after('url', ['/broken'], undefined, new Error('net::ERR_FAILED'))
    )
    await poll

    expect(rows().find((r) => r.command === 'url')?.error?.message).toBe(
      'net::ERR_FAILED'
    )
    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(rows().filter((r) => r.parentId === wait.id)).toHaveLength(1)
  })

  it('leaves a wait its own hook closed as it was', async () => {
    await elementWait([false, true])
    const before = [...sent]
    await endTest()

    expect(sent).toEqual(before)
    expect(
      rows().find((r) => r.command === 'waitForExist')?.error
    ).toBeUndefined()
  })

  it("keeps the error its own hook recorded rather than the test's", async () => {
    await elementWait([false], TIMEOUT)
    await endTest(new Error('a later assertion'))

    const wait = rows().find((r) => r.command === 'waitForExist')!
    expect(wait.error?.message).toBe(TIMEOUT.message)
  })
})

/** A run-long log already holding `earlier` rows, counting every element a lookup reads. */
function channel(earlier: number) {
  const rows: CommandLog[] = Array.from({ length: earlier }, (_, i) => ({
    command: 'click',
    args: [],
    timestamp: i
  }))
  let reads = 0
  const log = new Proxy(rows, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        reads++
      }
      return Reflect.get(target, prop, receiver)
    }
  })
  let next = 1
  const waitRows = new WaitRows({
    log: () => log,
    nextId: () => next++,
    sendCommand: (row) => row.id!,
    sendReplaceCommand: () => {}
  })
  return { waitRows, rows, reads: () => reads }
}

const logRow = (command: string, extra: Partial<CommandLog> = {}) =>
  ({ command, args: ['#flash'], timestamp: 1, ...extra }) as CommandLog

describe('WaitRows lookups', () => {
  it("finds a poll's row without reading the rows logged before its wait", () => {
    const { waitRows, rows, reads } = channel(10_000)
    const id = waitRows.send(logRow('waitUntil', { args: [] }))
    const before = reads()
    for (let poll = 0; poll < 20; poll++) {
      waitRows.send(
        logRow('getText', { parentId: id, callSource: 'spec.ts:3' })
      )
    }
    waitRows.close(logRow('waitUntil', { args: [], result: true }), id)

    expect(reads() - before).toBeLessThan(200)
    expect(rows.slice(-2).map((r) => [r.command, r.id])).toEqual([
      ['getText', 2],
      ['waitUntil', id]
    ])
  })
})

describe('HooksInFlight', () => {
  it('returns the hook it tracks and settles once every tracked hook has, a rejected one included', async () => {
    const hooks = new HooksInFlight()
    const hook = Promise.reject(new Error('hook failed'))
    expect(hooks.track(hook)).toBe(hook)
    await expect(hook).rejects.toThrow('hook failed')
    let release = () => {}
    hooks.track(new Promise<void>((resolve) => (release = resolve)))
    const settled = hooks.settled(1000)
    release()
    expect(await settled).toBe(true)
  })

  it('gives up on a wedged hook after its ceiling', async () => {
    vi.useFakeTimers()
    try {
      const hooks = new HooksInFlight()
      hooks.track(new Promise<void>(() => {}))
      const settled = hooks.settled(1000)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await settled).toBe(false)
      expect(await hooks.settled(1000)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
