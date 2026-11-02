import assert from 'node:assert'
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  ASSERT_PATCHED_SYMBOL,
  clearTypedValues,
  scrubTypedText,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-core'
import { MASKED_VALUE } from '@wdio/devtools-shared'

import DevToolsHookService from '../src/index.js'
import { SessionCapturer } from '../src/session.js'

// A command issued from the spec carries a user frame on its stack; one WDIO issues internally does not.
const stack = vi.hoisted(() => {
  const user = {
    getFileName: () => '/test/specs/login.spec.ts',
    getLineNumber: () => 7,
    getColumnNumber: () => 3
  }
  return { user, frames: [user] as unknown[] }
})
vi.mock('stack-trace', () => ({ parse: () => stack.frames }))
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
  scriptAddPreloadScript: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  emit: vi.fn(),
  addCommand: vi.fn()
} as unknown as WebdriverIO.Browser

// before() wires node:assert capture; restore the real methods afterwards.
const patchedAssert = assert as unknown as Record<string | symbol, unknown>
const originalAssert = Object.fromEntries(
  TRACKED_ASSERT_METHODS.map((method) => [method, patchedAssert[method]])
)
afterAll(() => {
  delete patchedAssert[ASSERT_PATCHED_SYMBOL]
  Object.assign(patchedAssert, originalAssert)
})

let service: DevToolsHookService

const command = async (
  name: string,
  args: unknown[],
  { user = true, inner = async () => {} } = {}
) => {
  stack.frames = user ? [stack.user] : []
  await service.beforeCommand(name, args as string[])
  await inner()
  stack.frames = user ? [stack.user] : []
  await service.afterCommand(name as never, args, undefined, undefined)
}

const typing = (text: string) => [
  {
    type: 'key',
    id: 'keyboard',
    actions: [...text].flatMap((ch) => [
      { type: 'keyDown', value: ch },
      { type: 'keyUp', value: ch }
    ])
  }
]

describe('typed text in the WebdriverIO hooks', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(SessionCapturer.prototype, 'sendUpstream').mockImplementation(
      () => {}
    )
    service = new DevToolsHookService()
    await service.before({} as never, [], browser)
    clearTypedValues()
  })

  it('remembers what the test typed before the command runs', async () => {
    stack.frames = [stack.user]
    await service.beforeCommand('setValue', ['S3cret pass'])
    expect(scrubTypedText('S3cret pass')).toBe(MASKED_VALUE)
  })

  it('remembers nothing from a command WebdriverIO issues inside another', async () => {
    await command('click', [], {
      inner: () =>
        command('performActions', [typing('S3cret pass')], { user: false })
    })
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
  })

  it('forgets what was typed when the next test starts', async () => {
    await command('setValue', ['S3cret pass'])
    service.beforeTest({ title: 'next', fullTitle: 'next' })
    expect(scrubTypedText('S3cret pass')).toBe('S3cret pass')
  })
})
