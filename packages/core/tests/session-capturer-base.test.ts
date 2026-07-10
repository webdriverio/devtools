import { describe, it, expect, beforeEach } from 'vitest'
import { SessionCapturerBase } from '../src/session-capturer.js'

/**
 * Test subclass that exposes the protected `processTracePayload` and
 * captures `sendUpstream` calls in-memory. Constructed with no WS opts so
 * the base skips the network connection entirely — keeps tests offline.
 */
class TestSessionCapturer extends SessionCapturerBase {
  upstream: Array<{ scope: string; data: unknown }> = []

  constructor() {
    super({})
  }

  override sendUpstream(event: string, data: unknown): void {
    this.upstream.push({ scope: event, data })
  }

  process(
    payload: {
      mutations?: unknown
      traceLogs?: unknown
      consoleLogs?: unknown
      networkRequests?: unknown
      metadata?: unknown
    },
    opts?: { skipConsoleLogs?: boolean; skipNetworkRequests?: boolean }
  ) {
    // @ts-expect-error — accessing protected method from same-module subclass
    return this.processTracePayload(payload, opts)
  }
}

let cap: TestSessionCapturer
beforeEach(() => {
  cap = new TestSessionCapturer()
})

describe('processTracePayload — metadata merge', () => {
  it('merges metadata across calls (later writes win on overlap; prior keys preserved)', () => {
    cap.process({ metadata: { url: 'first', sessionId: 'a' } })
    cap.process({ metadata: { url: 'second' } })
    expect(cap.metadata?.url).toBe('second')
    expect(cap.metadata?.sessionId).toBe('a')
    // Each metadata call produces one broadcast
    expect(cap.upstream.filter((u) => u.scope === 'metadata')).toHaveLength(2)
  })
})

describe('processTracePayload — BiDi gating (the duplicate-suppression contract)', () => {
  it('skips consoleLogs/networkRequests entirely when their skip flag is set', () => {
    cap.process(
      {
        consoleLogs: [{ type: 'info', args: ['x'], timestamp: 1 }],
        networkRequests: [
          {
            id: 'r1',
            url: 'https://x',
            method: 'GET',
            timestamp: 1,
            startTime: 0,
            type: 'fetch'
          }
        ]
      },
      { skipConsoleLogs: true, skipNetworkRequests: true }
    )
    expect(cap.consoleLogs).toEqual([])
    expect(cap.networkRequests).toEqual([])
    expect(
      cap.upstream.find(
        (u) => u.scope === 'consoleLogs' || u.scope === 'networkRequests'
      )
    ).toBeUndefined()
  })

  it('still pushes consoleLogs/networkRequests when no gate is set, tagging logs source="browser"', () => {
    cap.process({
      consoleLogs: [{ type: 'info', args: ['x'], timestamp: 1, source: 'test' }]
    })
    expect(cap.consoleLogs[0].source).toBe('browser') // overridden
    expect(cap.upstream.find((u) => u.scope === 'consoleLogs')).toBeDefined()
  })
})

describe('processTracePayload — mutations + traceLogs', () => {
  it('ignores non-array values defensively', () => {
    cap.process({
      mutations: 'not-an-array' as unknown,
      traceLogs: { obj: 'not-an-array' } as unknown
    })
    expect(cap.mutations).toEqual([])
    expect(cap.traceLogs).toEqual([])
  })

  it('pushes valid arrays and broadcasts on their respective scopes', () => {
    cap.process({
      mutations: [
        { type: 'childList', addedNodes: [], removedNodes: [], timestamp: 1 }
      ],
      traceLogs: ['first', 'second']
    })
    expect(cap.mutations).toHaveLength(1)
    expect(cap.traceLogs).toEqual(['first', 'second'])
    expect(cap.upstream.find((u) => u.scope === 'mutations')).toBeDefined()
    expect(cap.upstream.find((u) => u.scope === 'logs')).toBeDefined()
  })
})

describe('captureSource', () => {
  it('caches by file path — second read is a no-op', async () => {
    const filePath = new URL(import.meta.url).pathname
    await cap.captureSource(filePath)
    await cap.captureSource(filePath)
    expect(cap.upstream.filter((u) => u.scope === 'sources')).toHaveLength(1)
    expect(cap.sources.size).toBe(1)
  })

  it('calls onSourceReadError when the file is missing (no broadcast)', async () => {
    const errors: Array<{ file: string; err: unknown }> = []
    class Hooked extends TestSessionCapturer {
      protected override onSourceReadError(file: string, err: unknown) {
        errors.push({ file, err })
      }
    }
    const c = new Hooked()
    await c.captureSource('/totally/missing/path.ts')
    expect(errors).toHaveLength(1)
    expect(c.sources.size).toBe(0)
    expect(c.upstream.find((u) => u.scope === 'sources')).toBeUndefined()
  })
})

describe('sendCommand', () => {
  it('strips internal _id from the broadcast payload', () => {
    cap.sendCommand({ _id: 42, command: 'click', args: [], timestamp: 1 })
    const sent = cap.upstream.find((u) => u.scope === 'commands')!
    const payload = (sent.data as Array<Record<string, unknown>>)[0]
    expect(payload._id).toBeUndefined()
    expect(payload.command).toBe('click')
  })

  it('auto-allocates _id when omitted', () => {
    const id = cap.sendCommand({ command: 'click', args: [], timestamp: 1 })
    expect(id).toBe(0)
  })

  it('de-dupes — second call with same _id is a no-op', () => {
    cap.sendCommand({ _id: 7, command: 'a', args: [], timestamp: 1 })
    cap.sendCommand({ _id: 7, command: 'b', args: [], timestamp: 2 })
    expect(cap.upstream.filter((u) => u.scope === 'commands')).toHaveLength(1)
  })
})

describe('failLastAction', () => {
  const boom = { name: 'Error', message: 'boom' }

  it('marks the most-recent action of the test when it has no error', () => {
    cap.commandsLog.push({
      command: 'expect.toBeExisting',
      args: [],
      timestamp: 1,
      testUid: 't1'
    })
    expect(cap.failLastAction('t1', boom)).toBe(true)
    expect(cap.commandsLog[0]!.error).toEqual(boom)
  })

  it('does not bleed onto an earlier passing action when the latest one already failed', () => {
    // Regression: a failing expect matcher is captured as its own row via
    // afterAssertion, so failLastAction must stop at it — NOT stamp the error
    // onto the preceding passing assertion (the toBeExisting-shown-red bug).
    const matcherErr = { name: 'Error', message: 'to have text' }
    cap.commandsLog.push(
      { command: 'expect.toBeExisting', args: [], timestamp: 1, testUid: 't1' },
      {
        command: 'expect.toHaveText',
        args: [],
        timestamp: 2,
        testUid: 't1',
        error: matcherErr
      }
    )
    expect(cap.failLastAction('t1', boom)).toBe(false)
    expect(cap.commandsLog[0]!.error).toBeUndefined()
    expect(cap.commandsLog[1]!.error).toEqual(matcherErr)
  })

  it('ignores actions belonging to a different test', () => {
    cap.commandsLog.push({
      command: 'expect.toBeExisting',
      args: [],
      timestamp: 1,
      testUid: 'other'
    })
    expect(cap.failLastAction('t1', boom)).toBe(false)
    expect(cap.commandsLog[0]!.error).toBeUndefined()
  })
})
