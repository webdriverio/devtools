import * as fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { remote } from 'webdriverio'

import {
  openDevtoolsBrowser,
  type RunLifecycleCtx
} from '../src/run-lifecycle.js'

vi.mock('webdriverio', () => ({ remote: vi.fn() }))
vi.mock('@wdio/devtools-backend', () => ({ start: vi.fn(), stop: vi.fn() }))

function makeCtx(): RunLifecycleCtx {
  // openDevtoolsBrowser reads only these fields; the managers and reporter are irrelevant here.
  return {
    options: { hostname: 'localhost', port: 3000 },
    devtoolsBrowser: undefined,
    userDataDir: undefined
  } as unknown as RunLifecycleCtx
}

describe('openDevtoolsBrowser', () => {
  const browser = { url: vi.fn().mockResolvedValue(undefined) }
  let ctx: RunLifecycleCtx

  beforeEach(() => {
    vi.mocked(remote).mockResolvedValue(browser as never)
    ctx = makeCtx()
  })

  afterEach(() => {
    if (ctx.userDataDir) {
      fs.rmSync(ctx.userDataDir, { recursive: true, force: true })
    }
    vi.clearAllMocks()
  })

  it('opens the dashboard over WebDriver, which needs no `devtools` package', async () => {
    await openDevtoolsBrowser(ctx, 'http://localhost:3000')

    const [params] = vi.mocked(remote).mock.calls[0]
    expect(params).not.toHaveProperty('automationProtocol')
    expect(params.capabilities).not.toHaveProperty('wdio:devtoolsOptions')
    expect(params.capabilities).toEqual(
      expect.objectContaining({
        browserName: 'chrome',
        'goog:chromeOptions': expect.objectContaining({
          excludeSwitches: ['enable-automation'],
          args: expect.arrayContaining([`--user-data-dir=${ctx.userDataDir}`])
        })
      })
    )
    expect(browser.url).toHaveBeenCalledWith('http://localhost:3000')
    expect(ctx.devtoolsBrowser).toBe(browser)
  })

  it('leaves the run going when the window cannot be opened', async () => {
    vi.mocked(remote).mockRejectedValue(new Error('no chromedriver'))

    await expect(
      openDevtoolsBrowser(ctx, 'http://localhost:3000')
    ).resolves.toBeUndefined()
    expect(ctx.devtoolsBrowser).toBeUndefined()
  })
})
