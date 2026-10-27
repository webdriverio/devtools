import { describe, it, expect } from 'vitest'
import { RetryTracker } from '@wdio/devtools-core'
import { captureOrReplaceCommand } from '../src/helpers/captureOrReplaceCommand.js'
import { SessionCapturer } from '../src/session.js'
import type { CapturedCommand, TestStats, WaitScope } from '../src/types.js'

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

  it('turns the row a failed wait() folded its polls into into the failed wait', async () => {
    const capturer = new SessionCapturer({})
    const retryTracker = new RetryTracker()
    const scope: WaitScope = { rows: new Map() }
    const poll = (timestamp: number, callSource?: string) =>
      command({
        command: 'findElements',
        args: ['By.css selector("h1")'],
        fromElement: false,
        callSource,
        waitScope: scope,
        pollKey: 'findElements#0',
        timestamp,
        startTime: timestamp - 3,
        result: []
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
        cmd: command({
          command: 'wait',
          args: ['for element to be located By(css selector, h1)', 10_000],
          fromElement: false,
          error: new Error('Wait timed out after 10054ms'),
          callSource: '/spec.js:22',
          concludesWait: scope,
          timestamp: 11_000,
          startTime: 990
        })
      })
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0]).toMatchObject({
        command: 'wait',
        args: ['for element to be located By(css selector, h1)', 10_000],
        callSource: '/spec.js:22',
        timestamp: 11_000,
        startTime: 990,
        error: { message: 'Wait timed out after 10054ms' }
      })
      // A later poll-shaped call is the user's own, not a fold into the failed wait.
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: { ...poll(12_000, '/spec.js:30'), waitScope: undefined }
      })
      expect(capturer.commandsLog).toHaveLength(2)
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
    try {
      const own = await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: find(1_000, { callSource: '/spec.js:10', result: ['el'] })
      })
      const ownRow = { ...capturer.commandsLog[0] }
      // A helper's wait: its polls carry the same command and args but no call site.
      for (const timestamp of [2_000, 2_200, 2_400]) {
        await captureOrReplaceCommand({
          capturer,
          retryTracker,
          test,
          cmd: find(timestamp, {
            callSource: undefined,
            waitScope: scope,
            pollKey: 'findElements#0'
          })
        })
      }
      await captureOrReplaceCommand({
        capturer,
        retryTracker,
        test,
        cmd: command({
          command: 'wait',
          args: ['for element to be located By(css selector, h1)', 400],
          fromElement: false,
          error: new Error('Wait timed out after 400ms'),
          callSource: undefined,
          concludesWait: scope,
          timestamp: 2_500,
          startTime: 1_990
        })
      })
      expect(capturer.commandsLog).toHaveLength(2)
      expect(capturer.commandsLog[0]).toEqual(ownRow)
      expect(capturer.commandsLog[0].id).toBe(own.id)
      expect(capturer.commandsLog[1]).toMatchObject({
        command: 'wait',
        error: { message: 'Wait timed out after 400ms' }
      })
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

  it('lists a failed wait() that issued no command as a row of its own', async () => {
    const capturer = new SessionCapturer({})
    try {
      await captureOrReplaceCommand({
        capturer,
        retryTracker: new RetryTracker(),
        test,
        cmd: command({
          command: 'wait',
          args: ['[Function]'],
          fromElement: false,
          error: new Error('Wait timed out after 50ms'),
          concludesWait: { rows: new Map() }
        })
      })
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0].command).toBe('wait')
    } finally {
      capturer.cleanup()
    }
  })
})
