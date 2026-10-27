import { describe, it, expect, vi } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import {
  sessionExecutor,
  webdriverExecute as executeInPage
} from '../src/helpers/webdriverHttp.js'
import type { NightwatchBrowser } from '../src/types.js'

const webdriverExecute = vi.hoisted(() => vi.fn(async () => 'L1'))
const webdriverPost = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  webdriverExecute,
  webdriverPost
}))

const browser = (
  sessionId: string | undefined,
  webdriver: Record<string, unknown> = { host: '127.0.0.1', port: 4724 }
) => ({ sessionId, options: { webdriver } }) as unknown as NightwatchBrowser

describe('sessionExecutor', () => {
  it('posts an Appium execute method to the session current when it was built', async () => {
    const b = browser('sess-1')
    const execute = sessionExecutor(b)!
    ;(b as { sessionId?: string }).sessionId = 'sess-2'

    await execute('interceptor: startListening', [{}])

    expect(webdriverExecute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: '127.0.0.1', port: 4724 }),
      'sess-1',
      'interceptor: startListening',
      [{}]
    )
  })

  it('carries the configured path prefix', async () => {
    await sessionExecutor(
      browser('sess-1', { port: 4723, default_path_prefix: '/wd/hub' })
    )!('interceptor: startListening', [{}])
    expect(webdriverExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 4723, path: '/wd/hub' }),
      'sess-1',
      'interceptor: startListening',
      [{}]
    )
  })

  it('is undefined without a session', () => {
    expect(sessionExecutor(browser(undefined))).toBeUndefined()
  })

  // Regression: a missing port defaulted to chromedriver's 9515 and blamed the plugin.
  it('is undefined when no WebDriver port is configured', () => {
    expect(sessionExecutor(browser('sess-1', {}))).toBeUndefined()
  })
})

// Regression: the probes, drains and performance read dropped the prefix, so a driver under `/wd/hub` rejected every one.
describe('the direct transport', () => {
  it('carries the configured path prefix', async () => {
    await executeInPage(
      browser('sess-1', { port: 4444, default_path_prefix: '/wd/hub' }),
      'return 1'
    )
    expect(webdriverPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 4444, path: '/wd/hub' }),
      'sess-1',
      'execute/sync',
      { script: 'return 1', args: [] }
    )
  })
})

// Regression: the direct transport always spoke plain http with no credentials, so a remote grid on https or behind basic auth refused every call.
describe('the direct connection', () => {
  const post = (webdriver: Record<string, unknown>) =>
    executeInPage(browser('sess-1', webdriver), 'return 1').then(
      () => (webdriverPost.mock.lastCall as unknown[])[0]
    )

  it('speaks https when Nightwatch is configured with ssl', async () => {
    expect(
      await post({ host: 'grid.example', port: 4444, ssl: true })
    ).toMatchObject({ protocol: 'https', port: 4444 })
  })

  it('speaks https on port 443 when ssl is left unset, as Nightwatch does', async () => {
    expect(await post({ host: 'grid.example', port: 443 })).toMatchObject({
      protocol: 'https'
    })
  })

  it('keeps an explicit ssl: false on port 443', async () => {
    expect(
      await post({ host: 'grid.example', port: 443, ssl: false })
    ).toMatchObject({ protocol: 'http' })
  })

  it('carries the configured username and access key', async () => {
    expect(
      await post({
        host: 'grid.example',
        port: 443,
        username: 'alice',
        access_key: 's3cret'
      })
    ).toMatchObject({ user: 'alice', key: 's3cret' })
  })

  it('sends no credentials without an access key', async () => {
    const at = await post({ host: 'grid.example', port: 4444, username: 'a' })
    expect(at).toMatchObject({ protocol: 'http' })
    expect(at).not.toHaveProperty('user')
  })

  it('gives the Appium executor the same connection', async () => {
    await sessionExecutor(
      browser('sess-1', {
        port: 4444,
        ssl: true,
        username: 'alice',
        access_key: 's3cret'
      })
    )!('interceptor: startListening', [{}])
    expect(webdriverExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        protocol: 'https',
        user: 'alice',
        key: 's3cret'
      }),
      'sess-1',
      'interceptor: startListening',
      [{}]
    )
  })
})
