import { describe, it, expect, vi } from 'vitest'
import { WS_SCOPE } from '@wdio/devtools-shared'
import {
  createWorkerMessageHandler,
  type WorkerMessageContext
} from '../src/worker-message-handler.js'

function makeCtx(overrides: Partial<WorkerMessageContext> = {}) {
  const broadcastToClients = vi.fn()
  const baselineStore = {
    resetActiveRun: vi.fn(),
    recordEvent: vi.fn()
  }
  const testRunner = {
    registerConfigFile: vi.fn()
  }
  const videoRegistry = new Map<string, string>()
  const ctx: WorkerMessageContext = {
    baselineStore:
      baselineStore as unknown as WorkerMessageContext['baselineStore'],
    testRunner: testRunner as unknown as WorkerMessageContext['testRunner'],
    videoRegistry,
    broadcastToClients,
    clientCount: () => 1,
    ...overrides
  }
  return { ctx, broadcastToClients, baselineStore, testRunner, videoRegistry }
}

const buf = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('createWorkerMessageHandler — clearCommands', () => {
  it('with a testUid: broadcasts clearExecutionData scoped to that uid; does NOT reset the baseline accumulator', () => {
    const { ctx, broadcastToClients, baselineStore } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: WS_SCOPE.clearCommands, data: { testUid: 't-1' } }))
    expect(baselineStore.resetActiveRun).not.toHaveBeenCalled()
    expect(broadcastToClients).toHaveBeenCalledWith(
      JSON.stringify({
        scope: WS_SCOPE.clearExecutionData,
        data: { uid: 't-1' }
      })
    )
  })

  it('without a testUid: resets baseline AND broadcasts a full-clear', () => {
    const { ctx, broadcastToClients, baselineStore } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: WS_SCOPE.clearCommands, data: {} }))
    expect(baselineStore.resetActiveRun).toHaveBeenCalledOnce()
    expect(broadcastToClients).toHaveBeenCalledWith(
      JSON.stringify({
        scope: WS_SCOPE.clearExecutionData,
        data: { uid: undefined }
      })
    )
  })
})

describe('createWorkerMessageHandler — config scope', () => {
  it('registers the config file and does NOT broadcast (control message)', () => {
    const { ctx, broadcastToClients, testRunner } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: 'config', data: { configFile: '/p/wdio.conf.ts' } }))
    expect(testRunner.registerConfigFile).toHaveBeenCalledWith(
      '/p/wdio.conf.ts'
    )
    expect(broadcastToClients).not.toHaveBeenCalled()
  })

  it('ignores config messages without a configFile', () => {
    const { ctx, testRunner } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: 'config', data: {} }))
    expect(testRunner.registerConfigFile).not.toHaveBeenCalled()
  })
})

describe('createWorkerMessageHandler — screencast scope (the videoPath strip)', () => {
  it('stores videoPath in the backend registry and forwards only sessionId to clients', () => {
    const { ctx, broadcastToClients, videoRegistry } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(
      buf({
        scope: 'screencast',
        data: {
          sessionId: 'sess-x',
          videoPath: '/abs/path/to/video.webm',
          videoFile: 'video.webm',
          frameCount: 42
        }
      })
    )
    // Backend keeps the absolute path private (security + path stripping)
    expect(videoRegistry.get('sess-x')).toBe('/abs/path/to/video.webm')
    // UI only ever sees the sessionId — never the path
    expect(broadcastToClients).toHaveBeenCalledWith(
      JSON.stringify({
        scope: 'screencast',
        data: { sessionId: 'sess-x' }
      })
    )
  })

  it('still broadcasts even when videoPath is missing (e.g. for re-fired notifications)', () => {
    const { ctx, broadcastToClients, videoRegistry } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: 'screencast', data: { sessionId: 'sess-y' } }))
    expect(videoRegistry.has('sess-y')).toBe(false)
    expect(broadcastToClients).toHaveBeenCalledWith(
      JSON.stringify({
        scope: 'screencast',
        data: { sessionId: 'sess-y' }
      })
    )
  })

  it('ignores screencast messages without a sessionId', () => {
    const { ctx, broadcastToClients, videoRegistry } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: 'screencast', data: { videoPath: '/x' } }))
    expect(videoRegistry.size).toBe(0)
    // No special-case broadcast — falls through to the generic forward
    expect(broadcastToClients).toHaveBeenCalledTimes(1)
  })
})

describe('createWorkerMessageHandler — pass-through behavior', () => {
  it('forwards unknown scopes verbatim to clients AND tees them into the baseline accumulator', () => {
    const { ctx, broadcastToClients, baselineStore } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    const msg = buf({ scope: 'commands', data: [{ command: 'click' }] })
    handler(msg)
    expect(broadcastToClients).toHaveBeenCalledWith(msg.toString())
    expect(baselineStore.recordEvent).toHaveBeenCalledWith('commands', [
      { command: 'click' }
    ])
  })

  it('does NOT tee control-frame scopes (clearCommands/config/screencast) into the accumulator', () => {
    const { ctx, baselineStore } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    handler(buf({ scope: WS_SCOPE.clearCommands, data: {} }))
    handler(buf({ scope: 'config', data: { configFile: '/p/wdio.conf.ts' } }))
    handler(buf({ scope: 'screencast', data: { sessionId: 's' } }))
    expect(baselineStore.recordEvent).not.toHaveBeenCalled()
  })

  it('forwards non-JSON messages verbatim without crashing', () => {
    const { ctx, broadcastToClients, baselineStore } = makeCtx()
    const handler = createWorkerMessageHandler(ctx)
    const garbage = Buffer.from('not-json-at-all{{')
    handler(garbage)
    // Falls through to the catch + raw forward branch
    expect(broadcastToClients).toHaveBeenCalledWith(garbage.toString())
    expect(baselineStore.recordEvent).not.toHaveBeenCalled()
  })
})
