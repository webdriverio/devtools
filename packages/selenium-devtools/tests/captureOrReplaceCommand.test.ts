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
})
