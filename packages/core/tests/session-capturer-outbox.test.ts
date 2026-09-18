/**
 * Publishing before the worker socket opens.
 *
 * A session's metadata and its first suites go out while the driver is still
 * being created — against Appium that is ~11 s before the socket opens. Dropped
 * silently, the live dashboard lost the whole run: `metadata.type` gates the
 * test-suite pane and `metadata.device` the mobile layout, so both were absent
 * with nothing logged to say why.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionCapturerBase } from '../src/session-capturer.js'

interface FakeSocketLike {
  readyState: number
  sent: string[]
  open: () => void
  fail: (event: 'close' | 'error') => void
}

const { sockets, FakeSocket } = vi.hoisted(() => {
  const sockets: FakeSocketLike[] = []
  class FakeSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    readyState = 0
    sent: string[] = []
    handlers: Record<string, ((...args: unknown[]) => void)[]> = {}

    constructor() {
      sockets.push(this as unknown as FakeSocketLike)
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      ;(this.handlers[event] ??= []).push(handler)
    }
    send(payload: string) {
      this.sent.push(payload)
    }
    open() {
      this.readyState = 1
      for (const handler of this.handlers.open ?? []) {
        handler()
      }
    }
    fail(event: 'close' | 'error') {
      this.readyState = 3
      for (const handler of this.handlers[event] ?? []) {
        handler(new Error('boom'))
      }
    }
  }
  return { sockets, FakeSocket }
})

vi.mock('ws', () => ({ WebSocket: FakeSocket }))

class TestSessionCapturer extends SessionCapturerBase {
  drops: string[] = []
  protected override onUpstreamDrop(event: string): void {
    this.drops.push(event)
  }
}

const scopes = (socket: FakeSocketLike) =>
  socket.sent.map((raw) => JSON.parse(raw).scope)

let capturer: TestSessionCapturer
let socket: FakeSocketLike

beforeEach(() => {
  sockets.length = 0
  capturer = new TestSessionCapturer({ hostname: 'localhost', port: 1234 })
  socket = sockets[sockets.length - 1]
})

describe('a message published while the socket is still connecting', () => {
  it('is delivered once the socket opens, not discarded', () => {
    capturer.sendUpstream('metadata', { type: 'testrunner' })
    expect(socket.sent).toHaveLength(0)

    socket.open()

    expect(scopes(socket)).toEqual(['metadata'])
    expect(capturer.drops).toEqual([])
  })

  // The app folds each metadata message into the previous one, so a flush that
  // reordered them would let an earlier partial overwrite a later value.
  it('preserves publication order across the flush', () => {
    capturer.sendUpstream('metadata', { type: 'testrunner' })
    capturer.sendUpstream('suites', { a: 1 })
    capturer.sendUpstream('commands', { b: 2 })

    socket.open()

    expect(scopes(socket)).toEqual(['metadata', 'suites', 'commands'])
  })

  it('sends straight through once open', () => {
    socket.open()
    capturer.sendUpstream('commands', { b: 2 })
    expect(scopes(socket)).toEqual(['commands'])
  })
})

describe('the buffer is bounded', () => {
  it('drops beyond the cap rather than growing for a run that never connects', () => {
    const cap = SessionCapturerBase.MAX_PENDING_UPSTREAM
    for (let i = 0; i < cap + 5; i++) {
      capturer.sendUpstream('commands', { i })
    }
    expect(capturer.drops).toHaveLength(5)

    socket.open()
    expect(socket.sent).toHaveLength(cap)
  })
})

describe('a socket that closes after opening', () => {
  it('drops rather than buffering — the dashboard is gone, not pending', () => {
    socket.open()
    socket.readyState = 3 // CLOSED
    capturer.sendUpstream('commands', { b: 2 })
    expect(capturer.drops).toEqual(['commands'])
  })
})

// An adapter's drop handler naturally wants to log, and `patchConsole`
// forwards console output upstream — so a logging handler re-enters
// sendUpstream, drops again and recurses until the stack blows. Observed as
// "Maximum call stack size exceeded" raised inside the user's own spec, which
// points nowhere near the capturer.
describe('a drop handler that logs', () => {
  class LoggingCapturer extends SessionCapturerBase {
    calls = 0
    protected override onUpstreamDrop(event: string): void {
      this.calls++
      // Stands in for `log.warn` reaching patched console and being forwarded.
      this.sendUpstream('console', { message: `dropped ${event}` })
    }
  }

  it('does not recurse', () => {
    const capturer = new LoggingCapturer({ hostname: 'localhost', port: 1234 })
    const socket = sockets[sockets.length - 1]
    socket.readyState = 3 // CLOSED — every send drops

    expect(() => capturer.sendUpstream('commands', { a: 1 })).not.toThrow()
    // The nested send drops too, but is not reported a second time.
    expect(capturer.calls).toBe(1)
  })
})

// A socket that dies before it ever opens is a dashboard that is not coming.
// Holding its buffer would retain the payloads — screenshots among them — for
// the run's length AND keep the adapter's drop warning silent, which is the
// silence the buffer exists to end, not to relocate.
describe('a socket that never opens', () => {
  it('reports and releases what it was holding', () => {
    capturer.sendUpstream('metadata', { type: 'testrunner' })
    capturer.sendUpstream('suites', { a: 1 })
    expect(capturer.drops).toEqual([])

    socket.fail('close')

    expect(capturer.drops).toEqual(['metadata', 'suites'])
    // Released, so a later open cannot replay a dashboard that already gave up.
    socket.open()
    expect(socket.sent).toHaveLength(0)
  })
})
