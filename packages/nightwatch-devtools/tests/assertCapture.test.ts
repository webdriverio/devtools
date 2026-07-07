import { describe, it, expect, vi, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import { wireAssertCapture } from '../src/helpers/assertCapture.js'
import type { SessionCapturer } from '../src/session.js'
import type { CommandLog } from '../src/types.js'

// Snapshot real methods so the process-wide patch is undone after this file.
const ASSERT_MUT = assert as unknown as Record<string | symbol, unknown>
const originals: Record<string, unknown> = {}
for (const method of TRACKED_ASSERT_METHODS) {
  originals[method] = ASSERT_MUT[method]
}
afterAll(() => {
  delete ASSERT_MUT[ASSERT_PATCHED_SYMBOL]
  for (const method of TRACKED_ASSERT_METHODS) {
    ASSERT_MUT[method] = originals[method]
  }
})

function makeFakeCapturer() {
  const commandsLog: CommandLog[] = []
  const captureCommand = vi.fn(
    (
      command: string,
      args: unknown[],
      result: unknown,
      error: Error | undefined,
      testUid?: string,
      callSource?: string,
      timestamp?: number
    ) => {
      commandsLog.push({
        command,
        args,
        result,
        error,
        testUid,
        callSource,
        timestamp: timestamp ?? Date.now()
      })
      return Promise.resolve(true)
    }
  )
  const sendCommand = vi.fn()
  // Fake narrowed to the three members the wiring touches.
  const capturer = {
    commandsLog,
    captureCommand,
    sendCommand
  } as unknown as SessionCapturer
  return { capturer, commandsLog, captureCommand, sendCommand }
}

describe('wireAssertCapture', () => {
  it('routes node:assert calls through captureCommand and sends the entry', () => {
    const live: {
      fake?: ReturnType<typeof makeFakeCapturer>
      uid?: string
    } = {}
    wireAssertCapture(
      () => live.fake?.capturer,
      () => live.uid
    )

    // No capturer yet — asserts must not throw from the capture path.
    expect(() => assert.ok(true)).not.toThrow()

    const fake = makeFakeCapturer()
    live.fake = fake
    live.uid = 'test-uid'
    assert.equal(2, 2)
    expect(fake.captureCommand).toHaveBeenCalledWith(
      'assert.equal',
      [2, 2],
      'passed',
      undefined,
      'test-uid',
      expect.any(String),
      expect.any(Number)
    )
    expect(fake.sendCommand).toHaveBeenCalledWith(fake.commandsLog[0])

    expect(() => assert.strictEqual('a', 'b')).toThrow()
    const failed = fake.commandsLog[1]
    expect(failed.command).toBe('assert.strictEqual')
    expect(failed.result).toBeUndefined()
    expect(failed.error).toBeInstanceOf(Error)
    expect(fake.sendCommand).toHaveBeenCalledTimes(2)
  })
})
