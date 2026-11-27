import { describe, it, expect, vi } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import { finalizeTraceExport } from '@wdio/devtools-core'
import { NightwatchDevToolsPlugin } from '../src/index.js'

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  finalizeTraceExport: vi.fn(async () => [])
}))
vi.mock('@wdio/devtools-backend', () => ({ start: vi.fn(), stop: vi.fn() }))

describe('telemetry mode finalize', () => {
  // The finalizer forces the manifest on the mode it is handed (core forcesManifest), so the mode must arrive as telemetry.
  it('hands the trace finalizer a telemetry context, which is what forces the manifest', async () => {
    const plugin = new NightwatchDevToolsPlugin({ mode: 'telemetry' })
    Object.assign(plugin, {
      suiteManager: { getAllSuites: () => new Map() },
      sessionCapturer: {
        metadata: { sessionId: 'session-1' },
        snapshotCaptures: [],
        nativeNetwork: { stop: vi.fn() },
        closeWebSocket: vi.fn(async () => {})
      }
    })
    await plugin.after()
    expect(finalizeTraceExport).toHaveBeenCalledTimes(1)
    expect(finalizeTraceExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'telemetry' })
    )
  })
})
