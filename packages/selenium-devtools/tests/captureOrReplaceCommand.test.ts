import { describe, it, expect } from 'vitest'
import { RetryTracker } from '@wdio/devtools-core'
import { captureOrReplaceCommand } from '../src/helpers/captureOrReplaceCommand.js'
import { SessionCapturer } from '../src/session.js'
import type { CapturedCommand, TestStats } from '../src/types.js'

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
    const poll = (timestamp: number, callSource?: string) =>
      command({
        command: 'getCurrentUrl',
        args: [],
        fromElement: false,
        callSource,
        duringWait: true,
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
        cmd: poll(1_600, '/spec.js:23')
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
})
