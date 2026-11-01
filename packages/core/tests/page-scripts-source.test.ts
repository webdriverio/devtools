import { describe, it, expect } from 'vitest'
import * as shared from '@wdio/devtools-shared'
import { CAPTURE_PERFORMANCE_SCRIPT } from '../src/performance-capture.js'
import {
  COLLECTOR_READY_EXPRESSION,
  collectorDrainExpression
} from '../src/script-loader.js'

// The backend serves shared's page scripts to the Python adapter and may not
// import core, so its route test can only compare against shared. This closes
// the loop: what core hands the JS adapters is that same source.
describe('core runs the page scripts the backend serves', () => {
  it('re-exports them from shared rather than declaring its own', () => {
    expect(CAPTURE_PERFORMANCE_SCRIPT).toBe(shared.CAPTURE_PERFORMANCE_SCRIPT)
    expect(COLLECTOR_READY_EXPRESSION).toBe(shared.COLLECTOR_READY_EXPRESSION)
    expect(collectorDrainExpression).toBe(shared.collectorDrainExpression)
    expect(shared.buildPageScripts().collectorDrain).toBe(
      collectorDrainExpression(true)
    )
  })
})
