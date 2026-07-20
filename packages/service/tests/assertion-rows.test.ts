import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'

// Mock the capturer: the service routes each expect matcher through
// coalesceAssertionIntoLastRead (fold into the matcher's read command) or, when
// there's no read to fold into, captureAssertCommand (a fresh row). These tests
// assert that routing; the fold itself is a capturer unit test (session.test).
const capturer = vi.hoisted(() => ({
  captureAssertCommand: vi.fn(),
  coalesceAssertionIntoLastRead: vi.fn(),
  failLastAction: vi.fn(),
  captureSource: vi.fn().mockResolvedValue(undefined),
  injectScript: vi.fn().mockResolvedValue(undefined),
  sendUpstream: vi.fn(),
  cleanup: vi.fn(),
  resetLastSelector: vi.fn(),
  resetRetryTracker: vi.fn(),
  commandsLog: [] as unknown[],
  sources: new Map<string, string>()
}))
vi.mock('../src/session.js', () => ({
  SessionCapturer: vi.fn(function (this: unknown) {
    return capturer
  })
}))

const pushActionSnapshotAt = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
)
vi.mock('../src/action-snapshot.js', () => ({
  pushActionSnapshotAt,
  captureActionSnapshot: vi.fn().mockResolvedValue(null),
  captureActionResult: vi.fn().mockResolvedValue(undefined)
}))

import DevToolsHookService from '../src/index.js'

const mockBrowser = {
  isBidi: true,
  sessionId: 's1',
  options: {},
  capabilities: {},
  takeScreenshot: vi.fn().mockResolvedValue('SHOT'),
  execute: vi
    .fn()
    .mockResolvedValue({ width: 1, height: 1, offsetLeft: 0, offsetTop: 0 }),
  on: vi.fn(),
  emit: vi.fn(),
  addCommand: vi.fn()
} as unknown as WebdriverIO.Browser

// before() wires node:assert capture; restore the real methods afterwards.
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

describe('DevtoolsService — expect.* assertion rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('folds the assertion into the matcher read (no fresh row or snapshot)', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(true)
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], mockBrowser)

    await service.afterAssertion({
      matcherName: 'toHaveText',
      expectedValue: 'Hi',
      result: { pass: false, message: () => 'nope' }
    })

    // Routed through the fold: the matcher's read becomes the expect row (it
    // already carries the correct callSource + screenshot + position).
    const [entry, isRead] =
      capturer.coalesceAssertionIntoLastRead.mock.calls[0]!
    expect(entry.command).toBe('expect.toHaveText')
    expect(entry.error).toMatchObject({ message: 'nope' })
    expect(isRead('getText')).toBe(true)
    expect(isRead('click')).toBe(false)
    // No duplicate fresh row, no fresh screenshot/snapshot.
    expect(capturer.captureAssertCommand).not.toHaveBeenCalled()
    expect(pushActionSnapshotAt).not.toHaveBeenCalled()
  })

  it('trace fallback: fresh row + screenshot + DOM snapshot when there is no read to fold', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(false)
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], mockBrowser)

    await service.afterAssertion({
      matcherName: 'toBe',
      expectedValue: 1,
      result: { pass: true }
    })

    const entry = capturer.captureAssertCommand.mock.calls[0]![0]
    expect(entry.command).toBe('expect.toBe')
    expect(entry.screenshot).toBe('SHOT')
    expect(pushActionSnapshotAt).toHaveBeenCalledWith(
      mockBrowser,
      'expect.toBe',
      entry.timestamp,
      expect.any(Array)
    )
  })

  it('live fallback: keeps the screenshot but pushes no DOM snapshot', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(false)
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    await service.afterAssertion({
      matcherName: 'toBe',
      expectedValue: 1,
      result: { pass: true }
    })

    const entry = capturer.captureAssertCommand.mock.calls[0]![0]
    expect(entry.screenshot).toBe('SHOT')
    expect(pushActionSnapshotAt).not.toHaveBeenCalled()
  })

  it('captureAssertions: false emits nothing (no fold, no fresh row)', async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      captureAssertions: false
    })
    await service.before({} as never, [], mockBrowser)

    await service.afterAssertion({
      matcherName: 'toExist',
      result: { pass: true }
    })

    expect(capturer.coalesceAssertionIntoLastRead).not.toHaveBeenCalled()
    expect(capturer.captureAssertCommand).not.toHaveBeenCalled()
    expect(pushActionSnapshotAt).not.toHaveBeenCalled()
  })

  it('afterAssertion clears the armed matcher so test end does not re-synthesize', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(true)
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    service.beforeAssertion({ matcherName: 'toHaveText', expectedValue: 'Hi' })
    await service.afterAssertion({
      matcherName: 'toHaveText',
      expectedValue: 'Hi',
      // a real matcher failure carries matcherResult, so failLastAction skips it
      result: { pass: false, message: () => 'nope' }
    })
    // afterAssertion fired → pending cleared; test end must not fold again.
    await service.afterTest({ file: '/s.ts' } as never, undefined, {
      error: Object.assign(new Error('nope'), {
        matcherResult: { pass: false }
      })
    } as never)

    expect(capturer.coalesceAssertionIntoLastRead).toHaveBeenCalledTimes(1)
    expect(capturer.captureAssertCommand).not.toHaveBeenCalled()
  })

  it('hard-throw (no afterAssertion): folds the throwing read into a failing expect row', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(true)
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    // Matcher armed, then getText hard-threw → afterAssertion never fires.
    service.beforeAssertion({
      matcherName: 'toHaveText',
      expectedValue: 'Your username is invalid!'
    })
    await service.afterTest({ file: '/s.ts' } as never, undefined, {
      error: new Error('element ("#flash") still not existing')
    } as never)

    const [entry, , foldErrored] =
      capturer.coalesceAssertionIntoLastRead.mock.calls[0]!
    expect(entry.command).toBe('expect.toHaveText')
    expect(entry.args).toEqual(['Your username is invalid!'])
    expect(entry.error.message).toContain('still not existing')
    expect(foldErrored).toBe(true) // folds even though the read carries an error
    expect(capturer.captureAssertCommand).not.toHaveBeenCalled()
  })

  it('hard-throw with no read to fold: emits a fresh failing expect row', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(false)
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    service.beforeAssertion({ matcherName: 'toBeDisplayed' })
    await service.afterTest({ file: '/s.ts' } as never, undefined, {
      error: new Error('element not found')
    } as never)

    const entry = capturer.captureAssertCommand.mock.calls[0]![0]
    expect(entry.command).toBe('expect.toBeDisplayed')
    expect(entry.error.message).toContain('element not found')
  })

  it('nested matcher aliases fold once (toBeChecked→toBeSelected)', async () => {
    capturer.coalesceAssertionIntoLastRead.mockReturnValue(true)
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    // toBeChecked delegates to toBeSelected — before/after fire twice, nested.
    service.beforeAssertion({ matcherName: 'toBeChecked' })
    service.beforeAssertion({ matcherName: 'toBeSelected' })
    await service.afterAssertion({
      matcherName: 'toBeSelected',
      result: { pass: true }
    })
    await service.afterAssertion({
      matcherName: 'toBeChecked',
      result: { pass: true }
    })

    // Only the outer afterAssertion emits — one row, labelled by the alias.
    expect(capturer.coalesceAssertionIntoLastRead).toHaveBeenCalledTimes(1)
    expect(
      capturer.coalesceAssertionIntoLastRead.mock.calls[0]![0].command
    ).toBe('expect.toBeChecked')
  })
})
