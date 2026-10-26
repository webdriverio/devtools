import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { remote } from 'webdriverio'

import { start } from '@wdio/devtools-backend'
import {
  openDevtoolsBrowser,
  runPluginBefore,
  type PluginBeforeCtx,
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

// Regression: Run all ran every spec in the config, because the backend never learned what the run selected.
describe('runPluginBefore', () => {
  const argv = [...process.argv]
  const env = { ...process.env }
  const pkg = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cli-')),
    'nightwatch'
  )
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"nightwatch"}')
  fs.writeFileSync(path.join(pkg, 'bin', 'nightwatch'), '')
  const nightwatchBin = path.join(pkg, 'bin', 'nightwatch')

  afterEach(() => {
    process.argv = [...argv]
    process.env = { ...env }
  })

  const ctx = () =>
    ({
      options: { hostname: 'localhost', port: 39417, mode: 'live' },
      setConfigPath: vi.fn(),
      openDevtoolsBrowserAt: vi.fn(async () => {}),
      handleReuse: vi.fn(),
      plugin: {}
    }) as unknown as PluginBeforeCtx

  it('hands the backend the selection the Nightwatch CLI was launched with', async () => {
    delete process.env.DEVTOOLS_APP_REUSE
    delete process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS
    process.argv = ['/usr/bin/node', nightwatchBin, '--tag', 'smoke']
    // Stops the run at start(), which comes after the selection is stamped.
    vi.mocked(start).mockRejectedValueOnce(new Error('stop here'))
    await expect(runPluginBefore(ctx())).rejects.toThrow('stop here')
    expect(
      JSON.parse(process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS ?? '[]')
    ).toEqual(['--tag', 'smoke'])
  })

  // Regression: a bare run kept an inherited selection, so Run all replayed someone else's specs.
  it('clears an inherited selection when this run selects nothing', async () => {
    delete process.env.DEVTOOLS_APP_REUSE
    process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS = '["/old/tests/login.js"]'
    process.argv = ['/usr/bin/node', nightwatchBin, '--config', 'nw.conf.js']
    vi.mocked(start).mockRejectedValueOnce(new Error('stop here'))
    await expect(runPluginBefore(ctx())).rejects.toThrow('stop here')
    expect(process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS).toBeUndefined()
  })

  it('leaves the selection to the run that started the backend when it is a rerun', async () => {
    process.env.DEVTOOLS_APP_REUSE = '1'
    process.env.DEVTOOLS_APP_HOST = 'localhost'
    process.env.DEVTOOLS_APP_PORT = '3000'
    delete process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS
    process.argv = ['/usr/bin/node', nightwatchBin, '--testcase', 'one test']
    await runPluginBefore(ctx())
    expect(process.env.DEVTOOLS_NIGHTWATCH_INITIAL_ARGS).toBeUndefined()
  })
})
