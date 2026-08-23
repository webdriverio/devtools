/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from 'vitest'
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

describe('setSink', () => {
  const mutation = (target: string) =>
    ({
      type: 'attributes',
      target,
      addedNodes: [],
      removedNodes: [],
      timestamp: 1
    }) as TraceMutation

  it('pushes mutations instead of buffering them', () => {
    const sent: string[] = []
    const c = new DataCollector()
    c.setSink((payload) => sent.push(payload))
    c.captureMutation([mutation('1')])
    expect(JSON.parse(sent[0])).toEqual([mutation('1')])
    // Pushed, so a drain has nothing left to hand over — otherwise every
    // mutation would reach the dashboard twice.
    expect(c.getTraceData().mutations).toHaveLength(0)
  })

  it('emits a JSON string, not an object', () => {
    // BiDi serializes a channel argument under an object-depth limit, which
    // would truncate the document anchor. A string is depth-1.
    const sent: unknown[] = []
    const c = new DataCollector()
    c.setSink((payload) => sent.push(payload))
    c.captureMutation([mutation('1')])
    expect(typeof sent[0]).toBe('string')
  })

  it('flushes what was buffered before the sink arrived', () => {
    const sent: string[] = []
    const c = new DataCollector()
    c.captureMutation([mutation('early')])
    c.setSink((payload) => sent.push(payload))
    expect(JSON.parse(sent[0])).toEqual([mutation('early')])
    expect(c.getTraceData().mutations).toHaveLength(0)
  })

  it('does not emit an empty flush when nothing was buffered', () => {
    const sent: string[] = []
    const c = new DataCollector()
    c.setSink((payload) => sent.push(payload))
    expect(sent).toHaveLength(0)
  })

  it('falls back to the buffer when the channel throws', () => {
    // A channel dies with its session and teardown is when the last mutations
    // arrive, so dropping them would lose the final page state. A later drain
    // still recovers them.
    const c = new DataCollector()
    c.setSink(() => {
      throw new Error('channel gone')
    })
    c.captureMutation([mutation('late')])
    expect(c.getTraceData().mutations).toEqual([mutation('late')])
  })

  it('sends the document anchor through the channel', () => {
    // The anchor is the largest and earliest payload; if it took the buffer
    // while everything else pushed, replay would start from nothing.
    const sent: string[] = []
    const c = new DataCollector()
    c.setSink((payload) => sent.push(payload))
    c.captureCurrentDom()
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0])[0]).toMatchObject({ type: 'childList' })
  })
})
