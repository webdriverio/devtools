import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS,
  rememberReadValue
} from '@wdio/devtools-core'
import { wireAssertCapture } from '../src/helpers/assertCapture.js'
import type { SessionCapturer } from '../src/session.js'
import type { CommandCaptureMeta, CommandLog } from '../src/types.js'

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
      meta: CommandCaptureMeta = {}
    ) => {
      commandsLog.push({
        command,
        args,
        result,
        error,
        ...meta,
        timestamp: meta.timestamp ?? Date.now()
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

// One wiring for the file: patchNodeAssert is guarded per process, so a second
// wireAssertCapture call is a no-op and every test reads through these getters.
const live: {
  fake?: ReturnType<typeof makeFakeCapturer>
  uid?: string
} = {}
beforeAll(() => {
  wireAssertCapture(
    () => live.fake?.capturer,
    () => live.uid
  )
})

describe('wireAssertCapture', () => {
  it('routes node:assert calls through captureCommand and sends the entry', () => {
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
      expect.objectContaining({
        testUid: 'test-uid',
        callSource: expect.any(String),
        timestamp: expect.any(Number)
      })
    )
    expect(fake.sendCommand).toHaveBeenCalledWith(fake.commandsLog[0])

    expect(() => assert.strictEqual('a', 'b')).toThrow()
    const failed = fake.commandsLog[1]
    expect(failed.command).toBe('assert.strictEqual')
    expect(failed.result).toMatchObject({ passed: false })
    expect(failed.error).toBeInstanceOf(Error)
    expect(fake.sendCommand).toHaveBeenCalledTimes(2)
  })
})

describe('node:assert target selector', () => {
  function capture(run: () => void) {
    const fake = makeFakeCapturer()
    live.fake = fake
    live.uid = 'test-uid'
    run()
    return fake.commandsLog[0]
  }

  it('names the element whose read produced the asserted value', () => {
    // `assert.strictEqual(await browser.getText('#flash'), …)` names no element,
    // so the row's locator comes from what the command path recorded for the
    // value. Without it the player's overlay has nothing to box.
    rememberReadValue('You logged into a secure area!', '#flash')
    const row = capture(() => {
      assert.match('You logged into a secure area!', /secure area/)
    })
    expect(row.selector).toBe('#flash')
  })

  it('names no element when the value came from a page-level read', () => {
    // The null sentinel: `browser.title()` records its value as belonging to no
    // element, so a title assertion never inherits the box of an element that
    // happens to read the same text.
    rememberReadValue('The Internet', 'h1')
    rememberReadValue('The Internet', undefined)
    const row = capture(() => {
      assert.strictEqual('The Internet', 'The Internet')
    })
    expect(row.selector).toBeUndefined()
  })

  it('names no element for a comparison of literals', () => {
    const row = capture(() => {
      assert.strictEqual(6 * 7, 42)
    })
    expect(row.selector).toBeUndefined()
  })

  it('passes the selector to captureCommand, so the sent row carries it', () => {
    // The selector rides in on the capture call rather than being stamped onto
    // the pushed row afterwards — a row sent without it has no target to box.
    rememberReadValue('a-unique-read', '#subject')
    const fake = makeFakeCapturer()
    live.fake = fake
    live.uid = 'test-uid'
    assert.strictEqual('a-unique-read', 'a-unique-read')
    expect(fake.captureCommand).toHaveBeenCalledWith(
      'assert.strictEqual',
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({ selector: '#subject' })
    )
    expect(fake.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ selector: '#subject' })
    )
  })
})
