import { describe, it, expect, beforeEach } from 'vitest'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import type { TraceArtifact, TestOutcome } from '@wdio/devtools-core'

// Every case here is designed to no-op BEFORE the ffmpeg encode (failed gate or
// non-retaining policy), so no encoder/reporter mock is needed — the real
// (pure) shouldRetainTrace decides retention. The encode path itself is covered
// by core's video-slice.test.ts.
import { captureAndAttachVideo } from '../src/video-capture.js'

const frames: ScreencastFrame[] = [
  { data: 'AAAA', timestamp: 10 },
  { data: 'AAAA', timestamp: 20 },
  { data: 'AAAA', timestamp: 30 }
]

const failedOutcome: TestOutcome[] = [
  { uid: 'u1', attempt: 0, state: 'failed' }
]
const passedOutcome: TestOutcome[] = [
  { uid: 'u1', attempt: 0, state: 'passed' }
]

describe('captureAndAttachVideo gating', () => {
  const collected: TraceArtifact[] = []
  beforeEach(() => {
    collected.length = 0
  })

  const base = {
    mode: 'trace' as const,
    granularity: 'test' as const,
    policy: 'retain-on-failure' as const,
    frames,
    startWallTime: 0,
    outcomes: failedOutcome,
    attempt: 0,
    outputDir: '/tmp/does-not-encode',
    testUid: 'u1',
    sessionId: 'sess1234',
    onArtifact: (a: TraceArtifact) => collected.push(a)
  }

  it('no-ops outside test granularity', async () => {
    await captureAndAttachVideo({ ...base, granularity: 'session' })
    expect(collected).toHaveLength(0)
  })

  it('no-ops when the test never started (empty outcomes — no fail-open)', async () => {
    await captureAndAttachVideo({ ...base, outcomes: [] })
    expect(collected).toHaveLength(0)
  })

  it('no-ops when video policy is off/undefined', async () => {
    await captureAndAttachVideo({ ...base, policy: 'off' })
    await captureAndAttachVideo({ ...base, policy: undefined })
    expect(collected).toHaveLength(0)
  })

  it('no-ops when there are no frames', async () => {
    await captureAndAttachVideo({ ...base, frames: undefined })
    expect(collected).toHaveLength(0)
  })

  it('no-ops when the policy does not retain this outcome (passing + retain-on-failure)', async () => {
    await captureAndAttachVideo({ ...base, outcomes: passedOutcome })
    expect(collected).toHaveLength(0)
  })

  it('no-ops without a sessionId or uid', async () => {
    await captureAndAttachVideo({ ...base, sessionId: undefined })
    await captureAndAttachVideo({ ...base, testUid: undefined })
    expect(collected).toHaveLength(0)
  })
})
