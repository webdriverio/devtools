import { describe, it, expect, vi } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import { sessionExecutor } from '../src/helpers/webdriverHttp.js'
import type { NightwatchBrowser } from '../src/types.js'

const webdriverExecute = vi.hoisted(() => vi.fn(async () => 'L1'))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  webdriverExecute
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
