// The captured locator has to be one this runner can resolve — see shared's
// `locator-dialect.ts`. Separate from `actionSnapshot.test.ts` because reading
// the injected script back means mocking the WebDriver transport the probes go
// over, and `vi.mock` is file-scoped: mocking it there would change what the
// timestamp-binding cases exercise.

import { describe, expect, it, vi } from 'vitest'

import { SessionCapturer } from '../src/session.js'
import { webdriverExecute } from '../src/helpers/webdriverHttp.js'
import type { NightwatchBrowser, TestRunnerId } from '../src/types.js'

vi.mock('../src/helpers/webdriverHttp.js', () => ({
  webdriverExecute: vi.fn(async () => []),
  webdriverGet: vi.fn(async () => null),
  webdriverPost: vi.fn(async () => null),
  resolveWebDriverAddress: vi.fn(() => null)
}))

const mockBrowser = () => ({}) as unknown as NightwatchBrowser

async function injectedScripts(runner: TestRunnerId): Promise<string[]> {
  vi.mocked(webdriverExecute).mockClear()
  const cap = new SessionCapturer({}, mockBrowser())
  cap.traceMode = 'trace'
  cap.runner = runner
  await cap.captureCommand('click', ['#btn'], undefined, undefined)
  await Promise.all(cap.snapshotCaptures)
  cap.cleanup()
  return vi.mocked(webdriverExecute).mock.calls.map(([, src]) => String(src))
}

describe('nightwatch action-snapshot locator dialect', () => {
  it('injects the XPath text form for both Nightwatch runners', async () => {
    for (const runner of ['nightwatch', 'nightwatch-cucumber'] as const) {
      const scripts = await injectedScripts(runner)

      expect(scripts).not.toHaveLength(0)
      for (const src of scripts) {
        expect(src).not.toContain("tag + '*=' + text")
        expect(src).toContain("'[contains(., '")
      }
    }
  })

  it('injects the CSS-first branch order for both Nightwatch runners', async () => {
    // The runner decides where the text branch sits, not just what it emits —
    // `//button[…]` needs useXpath() here, so a native CSS locator wins when one
    // exists. This is the plumbing check: the adapter's runner has to reach the
    // ordering, not only the grammar.
    for (const runner of ['nightwatch', 'nightwatch-cucumber'] as const) {
      const scripts = await injectedScripts(runner)

      expect(scripts).not.toHaveLength(0)
      for (const src of scripts) {
        const composed = src.slice(src.indexOf('function getSelector'))

        expect(
          composed.indexOf('semanticCssSelector(element, tag)')
        ).toBeLessThan(composed.indexOf('textSelector(element, tag)'))
      }
    }
  })
})
