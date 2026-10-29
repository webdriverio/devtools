import { describe, it, expect } from 'vitest'
import { RetryTracker } from '@wdio/devtools-core'
import { captureOrReplaceCommand } from '../src/helpers/captureOrReplaceCommand.js'
import { SessionCapturer } from '../src/session.js'
import type {
  CapturedCommand,
  CommandLog,
  TestStats,
  WaitScope
} from '../src/types.js'

const test = { uid: 'test-1' } as TestStats

function command(overrides: Partial<CapturedCommand> = {}): CapturedCommand {
  return {
    command: 'click',
    args: [],
    result: undefined,
    error: undefined,
    callSource: '/spec.js:10:3',
    timestamp: 1_000,
    startTime: 950,
    fromElement: true,
    ...overrides
  }
}

describe('captureOrReplaceCommand', () => {
  it('stamps the resolved locator and invocation time onto the row', async () => {
    const capturer = new SessionCapturer({})
    try {
      const entry = await captureOrReplaceCommand({
        capturer,
        retryTracker: new RetryTracker(),
        test,
        cmd: command({ selector: '#username' })
      })
      expect(entry.selector).toBe('#username')
      expect(entry.startTime).toBe(950)
      expect(capturer.commandsLog[0].selector).toBe('#username')
    } finally {
      capturer.cleanup()
    }
  })

  it('leaves no locator on a command that resolved none', async () => {
    const capturer = new SessionCapturer({})
    try {
      const entry = await captureOrReplaceCommand({
        capturer,
        retryTracker: new RetryTracker(),
        test,
        cmd: command({ command: 'get', args: ['http://x'], fromElement: false })
      })
      expect(entry.selector).toBeUndefined()
    } finally {
      capturer.cleanup()
    }
  })

  it('keeps the locator when a retry replaces the row in place', async () => {
    // replaceCommand mutates the row to preserve `_id`/`id` for chained calls, so
    // a retry whose handle no longer resolves must not blank the locator.
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    try {
      const first = await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: command({ selector: '#username' })
      })
      const retried = await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: command({ timestamp: 2_000, startTime: 1_900 })
      })
      expect(retried._id).toBe(first._id)
      expect(capturer.commandsLog).toHaveLength(1)
      expect(retried.selector).toBe('#username')
      expect(retried.startTime).toBe(1_900)
    } finally {
      capturer.cleanup()
    }
  })

  it('folds polls that overlap in flight into one row', async () => {
    // selenium's `wait()` polls `getCurrentUrl` every 200 ms and the patcher
    // does not await `onCommand`, so the second poll used to be captured
    // before the first had its id and the Actions list showed it twice.
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const poll = (timestamp: number) =>
      command({
        command: 'getCurrentUrl',
        args: [],
        fromElement: false,
        callSource: undefined,
        timestamp,
        startTime: timestamp - 3
      })
    try {
      await Promise.all([
        captureOrReplaceCommand({
          capturer,
          retryTracker,
          test,
          cmd: poll(1_000)
        }),
        captureOrReplaceCommand({
          capturer,
          retryTracker,
          test,
          cmd: poll(1_200)
        }),
        captureOrReplaceCommand({
          capturer,
          retryTracker,
          test,
          cmd: poll(1_400)
        })
      ])
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0].timestamp).toBe(1_400)
    } finally {
      capturer.cleanup()
    }
  })

  it('folds the timer polls of a wait() into the row its first, sourced poll made', async () => {
    // The first poll runs inside the user's `wait()` call and carries its line;
    // the rest run from a timer with no user frame on the stack.
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const scope: WaitScope = { rows: new Map() }
    const poll = (timestamp: number, callSource?: string) =>
      command({
        command: 'getCurrentUrl',
        args: [],
        fromElement: false,
        callSource,
        waitScope: scope,
        pollKey: 'getCurrentUrl#0',
        timestamp,
        startTime: timestamp - 3,
        result: timestamp < 1_400 ? 'https://x/login' : 'https://x/secure'
      })
    try {
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: poll(1_000, '/spec.js:22')
      })
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: poll(1_200)
      })
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: poll(1_400)
      })
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0]).toMatchObject({
        callSource: '/spec.js:22',
        timestamp: 1_400,
        result: 'https://x/secure'
      })
      // The user's own later call of the same command is a row of its own.
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: { ...poll(1_600, '/spec.js:23'), waitScope: undefined }
      })
      expect(capturer.commandsLog).toHaveLength(2)
    } finally {
      capturer.cleanup()
    }
  })

  it('keeps a call with no call site as its own row outside a wait()', async () => {
    // A node_modules helper has no call site either; only a wait's own poll folds.
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const read = (timestamp: number, callSource?: string) =>
      command({
        command: 'getCurrentUrl',
        args: [],
        fromElement: false,
        callSource,
        timestamp,
        startTime: timestamp - 3
      })
    try {
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: read(1_000, '/spec.js:22')
      })
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: read(1_010)
      })
      expect(capturer.commandsLog).toHaveLength(2)
    } finally {
      capturer.cleanup()
    }
  })

  it('sends a wait running, nests its polls under it, and replaces it by id when it times out', async () => {
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const scope: WaitScope = { rows: new Map() }
    const sent: CommandLog[] = []
    const replaced: CommandLog[] = []
    capturer.sendCommand = (row) => {
      sent.push({ ...row })
      return row._id ?? 0
    }
    capturer.sendReplaceCommand = (_ts, row) => {
      replaced.push({ ...row })
    }
    const wait = (overrides: Partial<CapturedCommand>) =>
      command({
        command: 'waitForElementLocated',
        args: ['#missing', 10_000],
        fromElement: false,
        selector: '#missing',
        callSource: '/spec.js:22',
        wait: scope,
        timestamp: 990,
        startTime: 990,
        ...overrides
      })
    const poll = (timestamp: number, callSource?: string) =>
      command({
        command: 'findElements',
        args: ['By.css selector("#missing")'],
        fromElement: false,
        callSource,
        waitScope: scope,
        pollKey: 'findElements#0',
        timestamp,
        startTime: timestamp - 3,
        result: []
      })
    const capture = (cmd: CapturedCommand) =>
      captureOrReplaceCommand({ capturer, retryTracker, test, cmd })
    try {
      const opened = await capture(wait({ running: true }))
      await capture(poll(1_000, '/spec.js:22'))
      await capture(poll(1_200))
      await capture(
        wait({
          error: new Error('Wait timed out after 10054ms'),
          timestamp: 11_000
        })
      )
      expect(sent.map((row) => row.command)).toEqual([
        'waitForElementLocated',
        'findElements'
      ])
      expect(sent[0]).toMatchObject({ id: opened.id, startTime: 990 })
      expect(sent[0].timestamp).toBe(990)
      expect(sent[0].error).toBeUndefined()
      expect(sent[1].parentId).toBe(opened.id)
      expect(capturer.commandsLog).toHaveLength(2)
      expect(capturer.commandsLog[0]).toMatchObject({
        id: opened.id,
        command: 'waitForElementLocated',
        selector: '#missing',
        timestamp: 11_000,
        startTime: 990,
        error: { message: 'Wait timed out after 10054ms' }
      })
      expect(capturer.commandsLog[0].parentId).toBeUndefined()
      expect(capturer.commandsLog[1]).toMatchObject({
        parentId: opened.id,
        timestamp: 1_200
      })
      expect(replaced.at(-1)).toMatchObject({
        id: opened.id,
        timestamp: 11_000
      })
      // A later poll-shaped call is the user's own: no fold into the wait's child, and no parent.
      await capture({ ...poll(12_000, '/spec.js:30'), waitScope: undefined })
      expect(capturer.commandsLog).toHaveLength(3)
      expect(capturer.commandsLog[2].parentId).toBeUndefined()
    } finally {
      capturer.cleanup()
    }
  })

  it("never folds a wait's polls into an earlier row that is not its own", async () => {
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const scope: WaitScope = { rows: new Map() }
    const find = (timestamp: number, overrides: Partial<CapturedCommand>) =>
      command({
        command: 'findElements',
        args: ['By.css selector("h1")'],
        fromElement: false,
        timestamp,
        startTime: timestamp - 3,
        result: [],
        ...overrides
      })
    const capture = (cmd: CapturedCommand) =>
      captureOrReplaceCommand({ capturer, retryTracker, test, cmd })
    try {
      const own = await capture(
        find(1_000, { callSource: '/spec.js:10', result: ['el'] })
      )
      const ownRow = { ...capturer.commandsLog[0] }
      // A helper's wait: its polls carry the same command and args but no call site.
      const wait = await capture(
        command({
          command: 'wait',
          args: ['[Function]', 400],
          fromElement: false,
          callSource: undefined,
          wait: scope,
          running: true,
          timestamp: 1_990,
          startTime: 1_990
        })
      )
      for (const timestamp of [2_000, 2_200, 2_400]) {
        await capture(
          find(timestamp, {
            callSource: undefined,
            waitScope: scope,
            pollKey: 'findElements#0'
          })
        )
      }
      expect(capturer.commandsLog).toHaveLength(3)
      expect(capturer.commandsLog[0]).toEqual(ownRow)
      expect(capturer.commandsLog[0].id).toBe(own.id)
      expect(capturer.commandsLog[2].parentId).toBe(wait.id)
    } finally {
      capturer.cleanup()
    }
  })
  it('keeps a row a wait folded into older than its latest out of the retry tracker', async () => {
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const scope: WaitScope = { rows: new Map() }
    const read = (
      cmdName: string,
      timestamp: number,
      overrides: Partial<CapturedCommand> = {}
    ) =>
      command({
        command: cmdName,
        args: [],
        fromElement: false,
        callSource: '/spec.js:40',
        timestamp,
        startTime: timestamp - 3,
        ...overrides
      })
    const capture = (cmd: CapturedCommand) =>
      captureOrReplaceCommand({ capturer, retryTracker, test, cmd })
    try {
      await capture(
        read('getCurrentUrl', 1_000, {
          waitScope: scope,
          pollKey: 'getCurrentUrl#0'
        })
      )
      await capture(
        read('getTitle', 1_010, { waitScope: scope, pollKey: 'getTitle#0' })
      )
      // The next poll repeats only the url read, folding into the older row.
      await capture(
        read('getCurrentUrl', 1_200, {
          waitScope: scope,
          pollKey: 'getCurrentUrl#0'
        })
      )
      // The same title helper, after the wait: a call of its own.
      await capture(read('getTitle', 2_000))
      expect(capturer.commandsLog.map((row) => row.command)).toEqual([
        'getCurrentUrl',
        'getTitle',
        'getTitle'
      ])
    } finally {
      capturer.cleanup()
    }
  })

  it('keeps a wait nested in another wait on one row under the outer one across its outer polls', async () => {
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const inner: WaitScope = { rows: new Map() }
    const outer: WaitScope = {
      rows: new Map(),
      nested: new Map([['i', inner]])
    }
    const waitRow = (
      scope: WaitScope,
      parent: WaitScope | undefined,
      timestamp: number,
      running?: boolean
    ) =>
      command({
        command: 'wait',
        args: [scope === outer ? 'outer' : 'inner'],
        fromElement: false,
        wait: scope,
        waitScope: parent,
        running,
        timestamp,
        startTime: timestamp
      })
    const read = (timestamp: number) =>
      command({
        command: 'getTitle',
        fromElement: false,
        waitScope: inner,
        pollKey: 'getTitle#0',
        timestamp,
        startTime: timestamp - 1
      })
    const capture = (cmd: CapturedCommand) =>
      captureOrReplaceCommand({ capturer, retryTracker, test, cmd })
    try {
      const outerRow = await capture(waitRow(outer, undefined, 1_000, true))
      // Each outer poll calls the inner wait again: the same row, sent running again.
      for (const at of [1_010, 1_210]) {
        await capture(waitRow(inner, outer, at, true))
        await capture(read(at + 5))
        await capture(waitRow(inner, outer, at + 10))
      }
      await capture(waitRow(outer, undefined, 1_300))
      const rows = capturer.commandsLog
      expect(rows.map((row) => row.args[0] ?? row.command)).toEqual([
        'outer',
        'inner',
        'getTitle'
      ])
      expect(rows[0].id).toBe(outerRow.id)
      expect(rows[0].parentId).toBeUndefined()
      expect(rows[1].parentId).toBe(outerRow.id)
      expect(rows[2].parentId).toBe(rows[1].id)
    } finally {
      capturer.cleanup()
    }
  })
})
