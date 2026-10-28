import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import { wireAssertCapture } from '../src/assert-capture.js'
import { SessionCapturer } from '../src/session.js'

vi.mock('ws')
vi.mock('node:fs/promises')

// Regression (#481): a node:assert row took the last element any locator
// resolved, so an assertion on the page title boxed the heading read before it.
describe('node:assert target from value provenance', () => {
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

  const browser = {
    takeScreenshot: vi.fn().mockResolvedValue('shot')
  } as unknown as WebdriverIO.Browser
  let capturer: SessionCapturer
  wireAssertCapture(
    () => capturer,
    () => undefined
  )
  beforeEach(() => {
    capturer = new SessionCapturer()
  })

  /** What the service's hooks do for one top-level user command. */
  async function run(command: string, args: unknown[], result: unknown) {
    if (command === '$' && typeof args[0] === 'string') {
      capturer.noteResolvedSelector(args[0])
    }
    await capturer.afterCommand(
      browser,
      command as never,
      args,
      result,
      undefined
    )
  }
  const lastAssert = () =>
    capturer.commandsLog.filter((c) => c.command.startsWith('assert.')).at(-1)

  it('names no element for an assertion on the page title', async () => {
    await run('$', ['h2'], { 'element-6066-11e4-a52e-4f735466cecf': 'e1' })
    await run('getText', [], 'Login Page')
    const title = 'Login Page'
    await run('getTitle', [], title)
    assert.notEqual(title, 'Secure Area')
    expect(lastAssert()?.command).toBe('assert.notEqual')
    expect(lastAssert()?.selector).toBeUndefined()
  })

  it('names the element whose read produced the asserted value', async () => {
    await run('$', ['h2'], { 'element-6066-11e4-a52e-4f735466cecf': 'e1' })
    const heading = 'Welcome back'
    await run('getText', [], heading)
    await run('$', ['#logout'], { 'element-6066-11e4-a52e-4f735466cecf': 'e2' })
    await run('click', [], undefined)
    assert.equal(heading, 'Welcome back')
    expect(lastAssert()?.selector).toBe('h2')
  })
})
