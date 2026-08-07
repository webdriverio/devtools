// WDIO's `framework` config value IS its runner id, so the service reads it off
// the session rather than restating it — and the value has to be narrowed,
// because a user config can name a framework this build doesn't know.

import { describe, expect, it } from 'vitest'

import { TraceType, type Metadata } from '@wdio/devtools-shared'

import { stampRunnerMetadata, wdioRunnerId } from '../src/wdio-runner-id.js'

const browserWith = (options: unknown) =>
  ({ options }) as unknown as WebdriverIO.Browser

describe('wdioRunnerId', () => {
  it('reports the framework the run is configured with', () => {
    expect(wdioRunnerId(browserWith({ framework: 'cucumber' }))).toBe(
      'cucumber'
    )
    expect(wdioRunnerId(browserWith({ framework: 'jasmine' }))).toBe('jasmine')
  })

  it("falls back to WDIO's own default framework", () => {
    // A standalone session carries no framework at all.
    expect(wdioRunnerId(browserWith({}))).toBe('mocha')
    expect(wdioRunnerId(browserWith(undefined))).toBe('mocha')
  })

  it('rejects a framework this build has no id for', () => {
    expect(wdioRunnerId(browserWith({ framework: 'vitest' }))).toBe('mocha')
  })
})

describe('stampRunnerMetadata', () => {
  it('puts the runner where the trace exporter reads it', () => {
    // The service only ever sent metadata upstream, so `capturer.metadata` — the
    // exporter's input — carried no runner and the zip named none.
    const capturer: { metadata?: Metadata } = {}
    stampRunnerMetadata(
      capturer,
      browserWith({ framework: 'cucumber' }),
      TraceType.Testrunner
    )

    expect(capturer.metadata?.runner).toBe('cucumber')
    expect(capturer.metadata?.type).toBe(TraceType.Testrunner)
  })

  it('keeps whatever the collector already merged in', () => {
    const capturer: { metadata?: Metadata } = {
      metadata: { type: TraceType.Testrunner, url: 'http://example.test/' }
    }
    stampRunnerMetadata(capturer, browserWith({}), TraceType.Testrunner)

    expect(capturer.metadata?.url).toBe('http://example.test/')
    expect(capturer.metadata?.runner).toBe('mocha')
  })
})
