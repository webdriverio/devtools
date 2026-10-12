import { describe, it, expect, vi } from 'vitest'
import logger from '@wdio/logger'
import { waitForDevtoolsBrowserClose } from '../src/run-lifecycle.js'
import type { RunLifecycleCtx } from '../src/run-lifecycle.js'

vi.mock('@wdio/devtools-backend', () => ({ start: vi.fn(), stop: vi.fn() }))

describe('waitForDevtoolsBrowserClose', () => {
  it('restores the webdriver log level set before the wait', async () => {
    const wdLogger = logger as unknown as {
      (name: string): { getLevel: () => number }
      setLevel: (name: string, level: string) => void
    }
    wdLogger.setLevel('webdriver', 'error')
    const before = wdLogger('webdriver').getLevel()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    const ctx = {
      devtoolsBrowser: {
        getTitle: vi.fn().mockRejectedValue(new Error('closed')),
        deleteSession: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as RunLifecycleCtx

    await expect(waitForDevtoolsBrowserClose(ctx)).rejects.toThrow('exit')

    expect(wdLogger('webdriver').getLevel()).toBe(before)
    exit.mockRestore()
  })
})
