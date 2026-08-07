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
