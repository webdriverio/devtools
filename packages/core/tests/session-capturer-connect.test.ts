/**
 * What the capturer puts on the worker upgrade URL. The backend decides
 * whether to keep or wipe accumulated run state from these params alone, so a
 * missing one silently costs earlier specs their Preserve & Rerun data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RUNNER_ENV } from '@wdio/devtools-shared'
import { SessionCapturerBase } from '../src/session-capturer.js'

const { openedUrls } = vi.hoisted(() => ({ openedUrls: [] as string[] }))

vi.mock('ws', () => ({
  WebSocket: class {
    constructor(url: string) {
      openedUrls.push(url)
    }
    on() {}
  }
}))

class TestSessionCapturer extends SessionCapturerBase {}

function connect(opts: { reconnect?: boolean } = {}): URL {
  new TestSessionCapturer({ hostname: 'localhost', port: 1234, ...opts })
  return new URL(openedUrls[openedUrls.length - 1])
}

describe('worker socket URL', () => {
  beforeEach(() => {
    openedUrls.length = 0
    delete process.env[RUNNER_ENV.RUN_ID]
  })

  afterEach(() => {
    delete process.env[RUNNER_ENV.RUN_ID]
  })

  it('reports the run id from the environment the launcher stamped', () => {
    process.env[RUNNER_ENV.RUN_ID] = 'run-from-launcher'
    expect(connect().searchParams.get('runId')).toBe('run-from-launcher')
  })

  it('reports one run id for every socket the same process opens', () => {
    const first = connect().searchParams.get('runId')
    const second = connect({ reconnect: true }).searchParams.get('runId')
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })

  it('marks a mid-run reconnect and leaves a first connect unmarked', () => {
    expect(connect().searchParams.get('reconnect')).toBeNull()
    expect(connect({ reconnect: true }).searchParams.get('reconnect')).toBe('1')
  })

  it('opens no socket without a hostname and port', () => {
    new TestSessionCapturer({})
    expect(openedUrls).toEqual([])
  })
})
