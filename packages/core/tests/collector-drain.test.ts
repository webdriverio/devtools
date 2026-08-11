import { describe, it, expect } from 'vitest'
import {
  COLLECTOR_READY_EXPRESSION,
  collectorDrainExpression
} from '../src/script-loader.js'

describe('collectorDrainExpression', () => {
  it('guards on the collector before draining', () => {
    const expr = collectorDrainExpression()
    expect(expr).toContain(COLLECTOR_READY_EXPRESSION)
    expect(expr).toContain('return null;')
    expect(expr).toContain('getTraceData()')
  })

  it('omits the anchor when none is requested', () => {
    expect(collectorDrainExpression()).not.toContain('captureCurrentDom')
    expect(collectorDrainExpression(false)).not.toContain('captureCurrentDom')
  })

  it('anchors the document before draining when asked', () => {
    // Regression: without this the freshly injected collector's async initial
    // anchor loses the race with the drain, so a navigation destination's DOM
    // never reaches the trace — it dies in the page buffer at the next nav.
    const expr = collectorDrainExpression(true)
    expect(expr).toContain('captureCurrentDom()')
    expect(expr.indexOf('captureCurrentDom')).toBeLessThan(
      expr.indexOf('getTraceData')
    )
  })

  it('keeps the guard ahead of the anchor so a missing collector is safe', () => {
    const expr = collectorDrainExpression(true)
    expect(expr.indexOf('return null;')).toBeLessThan(
      expr.indexOf('captureCurrentDom')
    )
  })
})
