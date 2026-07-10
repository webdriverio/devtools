import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import assert from 'node:assert'
import {
  ASSERT_PATCHED_SYMBOL,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'

// Controlled synchronous stack for the beforeAssertion call-source walk.
const stackFrames = vi.hoisted(() => ({
  value: [] as Array<{
    getFileName: () => string | null
    getLineNumber: () => number | null
    getColumnNumber: () => number | null
  }>
}))
vi.mock('stack-trace', () => ({ parse: () => stackFrames.value }))

const capturer = vi.hoisted(() => ({
  captureAssertCommand: vi.fn(),
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
import type { ExpectAssertion } from '../src/assert-capture.js'

const userFrame = {
  getFileName: () => '/proj/specs/login.e2e.ts',
  getLineNumber: () => 30,
  getColumnNumber: () => 7
}

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
  emit: vi.fn()
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

const capturedEntry = () => capturer.captureAssertCommand.mock.calls[0]![0]

describe('DevtoolsService — expect.* assertion rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stackFrames.value = [userFrame]
  })

  it('trace mode: user-spec callSource, spec source loaded, DOM snapshot pushed', async () => {
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], mockBrowser)

    service.beforeAssertion()
    const params: ExpectAssertion = {
      matcherName: 'toExist',
      result: { pass: true, message: () => 'ok' }
    }
    await service.afterAssertion(params)

    const entry = capturedEntry()
    expect(entry.command).toBe('expect.toExist')
    // The regression: callSource must point at the user's spec, not the
    // service bundle (…/service/dist/index.js).
    expect(entry.callSource).toBe('/proj/specs/login.e2e.ts:30:7')
    expect(entry.callSource).not.toContain('/dist/')
    // Source of that file is loaded so the Source tab can render it.
    expect(capturer.captureSource).toHaveBeenCalledWith(
      '/proj/specs/login.e2e.ts'
    )
    // Live-mode screenshot kept for the CommandLog.
    expect(entry.screenshot).toBe('SHOT')
    // Trace-player Snapshot tab: a DOM snapshot stamped at the row timestamp.
    expect(pushActionSnapshotAt).toHaveBeenCalledWith(
      mockBrowser,
      'expect.toExist',
      entry.timestamp,
      expect.any(Array)
    )
    // WDIO reconciles rows by timestamp (like every regular WDIO command),
    // so assertion rows carry no public id — parity with regular commands.
    expect(entry.id).toBeUndefined()
  })

  it('live mode: keeps the screenshot but pushes no DOM snapshot', async () => {
    const service = new DevToolsHookService({ mode: 'live' })
    await service.before({} as never, [], mockBrowser)

    service.beforeAssertion()
    await service.afterAssertion({
      matcherName: 'toHaveText',
      expectedValue: 'Hi',
      result: { pass: false, message: () => 'nope' }
    })

    const entry = capturedEntry()
    expect(entry.command).toBe('expect.toHaveText')
    expect(entry.callSource).toBe('/proj/specs/login.e2e.ts:30:7')
    expect(entry.error).toMatchObject({ message: 'nope' })
    expect(entry.screenshot).toBe('SHOT')
    expect(pushActionSnapshotAt).not.toHaveBeenCalled()
  })

  it('captureAssertions: false suppresses the row but keeps the window balanced', async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      captureAssertions: false
    })
    await service.before({} as never, [], mockBrowser)

    service.beforeAssertion()
    await service.afterAssertion({
      matcherName: 'toExist',
      result: { pass: true }
    })

    expect(capturer.captureAssertCommand).not.toHaveBeenCalled()
    expect(pushActionSnapshotAt).not.toHaveBeenCalled()
  })
})
