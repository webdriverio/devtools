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

/**
 * The exporter serializes the capturer's own `metadata`, and before this method
 * the only writer of it was `processTracePayload` — i.e. the page-side
 * collector. A native session has no collector, so a value resolved on the
 * driver reached a live dashboard through `sendUpstream` and was then dropped
 * before the zip: that is why a native capture claimed a viewport it had never
 * measured.
 */
describe('mergeMetadata — the driver-side writer', () => {
  it('stores as well as publishes', () => {
    cap.mergeMetadata({ sessionId: 'a', url: 'first' })

    expect(cap.metadata?.sessionId).toBe('a')
    expect(cap.upstream).toEqual([
      { scope: 'metadata', data: { sessionId: 'a', url: 'first' } }
    ])
  })

  it('merges rather than replaces, so a partial cannot wipe a prior field', () => {
    cap.mergeMetadata({ device: { platform: 'ios', name: 'iPhone 17' } })
    cap.mergeMetadata({ url: 'https://example.com' })

    expect(cap.metadata?.device).toEqual({
      platform: 'ios',
      name: 'iPhone 17'
    })
    expect(cap.metadata?.url).toBe('https://example.com')
  })

  it('publishes the merged bag, not the fragment it was handed', () => {
    // The dashboard merges per session too, but sending the whole bag keeps a
    // late-joining client from seeing only the last fragment.
    cap.mergeMetadata({ sessionId: 'a' })
    cap.mergeMetadata({ url: 'later' })

    expect(cap.upstream.at(-1)?.data).toEqual({
      sessionId: 'a',
      url: 'later'
    })
  })

  it('is the path processTracePayload takes, so both writers agree', () => {
    cap.mergeMetadata({ sessionId: 'a' })
    cap.process({ metadata: { url: 'from-the-page' } })

    expect(cap.metadata).toEqual({ sessionId: 'a', url: 'from-the-page' })
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

describe('processTracePayload — DOM anchor attribution', () => {
  const anchor = (timestamp: number, url = 'https://example.com/next') => ({
    type: 'childList',
    url,
    addedNodes: [{ tag: 'html' }],
    removedNodes: [],
    timestamp
  })
  const cmd = (timestamp: number) => ({ command: 'click', args: [], timestamp })

  it('pulls the anchor onto the navigation still in flight', () => {
    // Adapter stamps commands at invocation, so the navigate's row ends before
    // the destination document exists and would replay the page it left.
    cap.commandsLog.push(cmd(1000))
    cap.process({ mutations: [anchor(1250)] })
    expect(cap.mutations[0]!.timestamp).toBe(1000)
  })

  it('leaves the anchor alone once a command has completed after it', () => {
    // Adapter stamps commands at completion: the navigate finished after the
    // document was born, so its row already resolves this anchor. Pulling it
    // back would hand the new page's DOM to actions still on the old one.
    cap.commandsLog.push(cmd(1000), cmd(1400))
    cap.process({ mutations: [anchor(1250)] })
    expect(cap.mutations[0]!.timestamp).toBe(1250)
  })

  it('leaves the anchor alone when every command completed after it', () => {
    cap.commandsLog.push(cmd(1400))
    cap.process({ mutations: [anchor(1250)] })
    expect(cap.mutations[0]!.timestamp).toBe(1250)
  })

  it('never pulls an anchor ahead of the document it replaces', () => {
    cap.mutations.push({
      type: 'attributes',
      target: '7',
      addedNodes: [],
      removedNodes: [],
      timestamp: 1100
    })
    cap.commandsLog.push(cmd(1000))
    cap.process({ mutations: [anchor(1250)] })
    expect(cap.mutations[1]!.timestamp).toBe(1100)
  })

  it('leaves observed diffs untouched', () => {
    cap.commandsLog.push(cmd(1000))
    cap.process({
      mutations: [
        {
          type: 'attributes',
          target: '35',
          addedNodes: [],
          removedNodes: [],
          timestamp: 1250
        }
      ]
    })
    expect(cap.mutations[0]!.timestamp).toBe(1250)
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

/** Selenium's own `getCapabilities()` is async, so the answer has to come from
 *  the capabilities the adapter already published. */
describe('SessionCapturerBase.isNativeAppSession', () => {
  const withCapabilities = (capabilities: unknown) => {
    const capturer = new TestSessionCapturer()
    capturer.metadata = { capabilities } as never
    return capturer
  }

  it('is true for a session that named no browser', () => {
    expect(
      withCapabilities({ platformName: 'Android', 'appium:app': '/a.apk' })
        .isNativeAppSession
    ).toBe(true)
  })

  it('is false for a phone running a browser', () => {
    expect(
      withCapabilities({ platformName: 'Android', browserName: 'Chrome' })
        .isNativeAppSession
    ).toBe(false)
  })

  it('is false before the adapter has published any metadata', () => {
    expect(new TestSessionCapturer().isNativeAppSession).toBe(false)
  })

  it('follows a merged metadata fragment', () => {
    // The adapters publish through `mergeMetadata`, so the answer has to track
    // it rather than being read once at construction.
    const capturer = new TestSessionCapturer()
    expect(capturer.isNativeAppSession).toBe(false)

    capturer.mergeMetadata({
      capabilities: { platformName: 'iOS', 'appium:app': '/a.app' }
    } as never)

    expect(capturer.isNativeAppSession).toBe(true)
  })
})
