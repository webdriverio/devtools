// The url/title probes go over the raw WebDriver transport, which answers
// `null` — not a rejection — when the session is gone or the call fails. Core's
// probe absorbs that, so the adapter hands the reader through unchanged; a
// separate file because `vi.mock` is file-scoped and the transport has to be
// stubbed per case here.

import { describe, expect, it, vi } from 'vitest'

import { captureActionSnapshot } from '../src/action-snapshot.js'
import { webdriverGet } from '../src/helpers/webdriverHttp.js'
import type { NightwatchBrowser } from '../src/types.js'

vi.mock('../src/helpers/webdriverHttp.js', () => ({
  webdriverExecute: vi.fn(async () => []),
  webdriverGet: vi.fn(async () => null),
  webdriverPost: vi.fn(async () => null),
  resolveWebDriverAddress: vi.fn(() => null)
}))

const mockBrowser = () => ({}) as unknown as NightwatchBrowser

describe('nightwatch action-snapshot driver probes', () => {
  it('normalizes a null url/title read to undefined', async () => {
    vi.mocked(webdriverGet).mockResolvedValue(null)

    const snap = await captureActionSnapshot(mockBrowser(), 'click', 42)

    expect(snap?.timestamp).toBe(42)
    expect(snap?.url).toBeUndefined()
    expect(snap?.title).toBeUndefined()
    expect(snap?.screenshot).toBeUndefined()
  })

  it('passes a successful read straight through', async () => {
    const reads: Record<string, string | null> = {
      url: 'https://example.test/login',
      title: 'Login Page',
      screenshot: null
    }
    vi.mocked(webdriverGet).mockImplementation(((
      _browser: NightwatchBrowser,
      path: string
    ) =>
      Promise.resolve(reads[path] ?? null)) as unknown as typeof webdriverGet)

    const snap = await captureActionSnapshot(mockBrowser(), 'click', 43)

    expect(snap?.url).toBe('https://example.test/login')
    expect(snap?.title).toBe('Login Page')
  })
})
