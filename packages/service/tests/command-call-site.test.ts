import vm from 'node:vm'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'

import DevToolsHookService from '../src/index.js'
import { SessionCapturer } from '../src/session.js'

vi.mock('ws')
vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn().mockRejectedValue(new Error('none')),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined)
  }
}))
vi.mock('../src/screencast-lifecycle.js', () => ({
  ScreencastLifecycle: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      markStart: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined)
    }
  })
}))
vi.mock('../src/intercepted-network.js', () => ({
  InterceptedNetwork: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      forward: vi.fn().mockResolvedValue(undefined)
    }
  })
}))

const browser = {
  isBidi: false,
  sessionId: 's1',
  options: {},
  capabilities: { browserName: 'chrome' },
  takeScreenshot: vi.fn().mockResolvedValue('SHOT'),
  execute: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  emit: vi.fn(),
  addCommand: vi.fn()
} as unknown as WebdriverIO.Browser

// Frames from dependencies, the way expect-webdriverio and WDIO's element wrappers sit between a spec and a hook.
const throughLibrary = vm.runInThisContext(
  '(function libraryFrame(depth, call) { return depth === 0 ? call() : libraryFrame(depth - 1, call) })',
  { filename: '/project/node_modules/expect-webdriverio/lib/matcher.js' }
) as <T>(depth: number, call: () => T) => T

describe("a command's call site", () => {
  let rows: CommandLog[]
  let service: DevToolsHookService

  beforeEach(async () => {
    rows = []
    vi.spyOn(SessionCapturer.prototype, 'sendUpstream').mockImplementation(
      (scope: string, data: unknown) => {
        if (scope === 'commands') {
          rows.push(...(data as CommandLog[]))
        }
      }
    )
    service = new DevToolsHookService()
    await service.before({} as never, [], browser)
    rows = []
  })

  // Regression: an expect matcher's read is 16 library frames below its spec line, which the hook's own wrapper pushed
  // past the stack limit, so the read had no row and its expect row no call site.
  it('is found as deep below the spec as an expect matcher issues its read', async () => {
    await throughLibrary(
      16,
      service.beforeCommand.bind(service, 'isExisting', [])
    )
    await service.afterCommand('isExisting' as never, [], true)
    expect(rows.map((r) => [r.command, r.callSource])).toEqual([
      ['isExisting', expect.stringContaining('command-call-site.test.ts')]
    ])
  })
})
