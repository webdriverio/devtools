import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TraceArtifact } from '@wdio/devtools-core'

// Mock only the three core entry points the helper touches — we verify the
// produce-only WIRING (attach: undefined, onArtifact collection, gate values
// forwarded), not core internals.
vi.mock('@wdio/devtools-core', () => ({
  lastRenderedScreenshot: vi.fn(() => 'SCREENSHOT_B64'),
  captureAndAttachScreenshot: vi.fn(
    async (input: {
      testUid?: string
      onArtifact: (a: TraceArtifact) => void
    }) => {
      input.onArtifact({
        kind: 'screenshot',
        path: '/out/screenshot.png',
        scope: 'test',
        key: input.testUid ?? '',
        testUids: input.testUid ? [input.testUid] : [],
        retained: true
      })
    }
  ),
  captureAndAttachVideo: vi.fn(
    async (input: {
      testUid?: string
      onArtifact: (a: TraceArtifact) => void
    }) => {
      input.onArtifact({
        kind: 'video',
        path: '/out/video.webm',
        scope: 'test',
        key: input.testUid ?? '',
        testUids: input.testUid ? [input.testUid] : [],
        retained: true
      })
    }
  )
}))

import {
  captureAndAttachScreenshot,
  captureAndAttachVideo,
  lastRenderedScreenshot
} from '@wdio/devtools-core'
import {
  emitTestArtifacts,
  type EmitTestArtifactsInput
} from '../src/test-artifacts.js'

function makeInput(overrides: Partial<EmitTestArtifactsInput> = {}): {
  input: EmitTestArtifactsInput
  artifacts: TraceArtifact[]
} {
  const artifacts: TraceArtifact[] = []
  const input: EmitTestArtifactsInput = {
    mode: 'trace',
    granularity: 'test',
    screenshotPolicy: 'on',
    videoPolicy: 'on',
    failed: false,
    actionSnapshots: [],
    frames: [],
    startWallTime: 1000,
    outcomes: [{ uid: 'uid-1', attempt: 0, state: 'passed' }],
    uid: 'uid-1',
    attempt: 0,
    sessionId: 'session-abcdef',
    outputDir: '/out',
    captureFormat: 'jpeg',
    onArtifact: (a) => artifacts.push(a),
    ...overrides
  }
  return { input, artifacts }
}

describe('emitTestArtifacts — produce-only per-test artifacts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drives both core produce fns with NO sink (attach: undefined)', async () => {
    const { input } = makeInput()
    await emitTestArtifacts(input)

    expect(captureAndAttachScreenshot).toHaveBeenCalledTimes(1)
    expect(captureAndAttachVideo).toHaveBeenCalledTimes(1)
    expect(captureAndAttachScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ attach: undefined })
    )
    expect(captureAndAttachVideo).toHaveBeenCalledWith(
      expect.objectContaining({ attach: undefined })
    )
  })

  it('collects the produced artifacts via onArtifact (manifest path)', async () => {
    const { input, artifacts } = makeInput()
    await emitTestArtifacts(input)

    expect(artifacts.map((a) => a.kind)).toEqual(['screenshot', 'video'])
    expect(artifacts.every((a) => a.scope === 'test')).toBe(true)
    expect(artifacts.every((a) => a.key === 'uid-1')).toBe(true)
  })

  it('forwards the gate + policy values and the sliced outcomes', async () => {
    const { input } = makeInput({
      screenshotPolicy: 'only-on-failure',
      failed: true,
      attempt: 1
    })
    await emitTestArtifacts(input)

    expect(lastRenderedScreenshot).toHaveBeenCalledWith([], 1000)
    expect(captureAndAttachScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'trace',
        granularity: 'test',
        policy: 'only-on-failure',
        failed: true,
        screenshotBase64: 'SCREENSHOT_B64',
        sessionId: 'session-abcdef',
        outputDir: '/out',
        testUid: 'uid-1'
      })
    )
    expect(captureAndAttachVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: 'on',
        outcomes: [{ uid: 'uid-1', attempt: 0, state: 'passed' }],
        attempt: 1,
        captureFormat: 'jpeg',
        testUid: 'uid-1'
      })
    )
  })
})
