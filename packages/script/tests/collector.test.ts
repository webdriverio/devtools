/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DataCollector } from '../src/collector.js'

const REF_ATTR = 'data-wdio-ref'

const clearRefs = () => {
  document.documentElement.removeAttribute(REF_ATTR)
  document.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => {
    el.removeAttribute(REF_ATTR)
  })
}

beforeEach(() => {
  document.body.replaceChildren()
  clearRefs()
})

describe('captureCurrentDom', () => {
  it('anchors only once per collector', () => {
    const c = new DataCollector()
    c.captureCurrentDom()
    c.captureCurrentDom()
    expect(c.getTraceData().mutations).toHaveLength(1)
  })

  it('does not re-anchor after a drain reset it', () => {
    // getTraceData() resets the buffer; re-anchoring on the next drain would
    // emit the whole document again on every poll.
    const c = new DataCollector()
    c.captureCurrentDom()
    c.getTraceData()
    c.captureCurrentDom()
    expect(c.getTraceData().mutations).toHaveLength(0)
  })

  it('anchors a document a previous collector already ref’d', () => {
    // Regression: injecting over a live collector replaces the global with a
    // fresh instance and discards its buffer, but the document keeps the refs
    // the old one assigned. Guarding the anchor on those refs meant the new
    // collector could never anchor — so a navigation destination's DOM vanished
    // from the trace entirely (observed: drain returned 0 mutations).
    const first = new DataCollector()
    first.captureCurrentDom()
    first.getTraceData()
    expect(document.documentElement.hasAttribute(REF_ATTR)).toBe(true)

    const replacement = new DataCollector()
    replacement.captureCurrentDom()
    const { mutations } = replacement.getTraceData()
    expect(mutations).toHaveLength(1)
  })

  it('reuses existing refs rather than renumbering the tree', () => {
    // Renumbering would desync every mutation the previous collector emitted.
    const div = document.createElement('div')
    div.append(document.createElement('span'))
    document.body.append(div)

    const first = new DataCollector()
    first.captureCurrentDom()
    const before = [...document.querySelectorAll(`[${REF_ATTR}]`)].map((el) =>
      el.getAttribute(REF_ATTR)
    )

    new DataCollector().captureCurrentDom()
    const after = [...document.querySelectorAll(`[${REF_ATTR}]`)].map((el) =>
      el.getAttribute(REF_ATTR)
    )
    expect(after).toEqual(before)
  })
})

describe('getTraceData network', () => {
  /** Plays Resource Timing entries into whichever collector is observing. */
  class FakeObserver {
    static callbacks: ((list: { getEntries: () => unknown[] }) => void)[] = []
    constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
      FakeObserver.callbacks.push(callback)
    }
    observe() {}
    static deliver(...entries: unknown[]) {
      for (const callback of FakeObserver.callbacks) {
        callback({ getEntries: () => entries })
      }
    }
  }
  const realObserver = globalThis.PerformanceObserver

  beforeEach(() => {
    FakeObserver.callbacks = []
    ;(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
      FakeObserver
  })

  afterEach(() => {
    ;(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
      realObserver
  })

  it('lists the patched calls and the Resource Timing rows together, by start', async () => {
    const realFetch = window.fetch
    window.fetch = (() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )) as typeof fetch
    try {
      const c = new DataCollector()
      await window.fetch('https://app.test/api/me')
      FakeObserver.deliver({
        name: 'https://app.test/app.js',
        entryType: 'resource',
        initiatorType: 'script',
        startTime: 1,
        responseEnd: 20,
        requestStart: 0,
        transferSize: 100
      })

      const { networkRequests } = c.getTraceData()
      expect(networkRequests.map((r) => [r.url, r.source])).toEqual([
        ['https://app.test/app.js', 'resource-timing'],
        ['https://app.test/api/me', undefined]
      ])
      // A drain takes both halves; the next one starts empty.
      expect(c.getTraceData().networkRequests).toEqual([])
    } finally {
      window.fetch = realFetch
    }
  })
})
