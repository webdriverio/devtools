import { describe, expect, it } from 'vitest'
import { pushSummary } from '../src/push-summary.js'

describe('pushSummary', () => {
  it('names the tests, manifests and runs pushed', () => {
    expect(
      pushSummary(3, {
        pushedManifests: 2,
        unsampledManifests: 0,
        runIds: ['r1']
      })
    ).toBe('pushed 3 test(s) from 2 manifest(s) across 1 run(s)')
  })

  it('counts the manifests skipped as unsampled beside a push', () => {
    expect(
      pushSummary(3, {
        pushedManifests: 2,
        unsampledManifests: 1,
        runIds: ['r1', 'r2']
      })
    ).toBe(
      'pushed 3 test(s) from 2 manifest(s) across 2 run(s); 1 manifest(s) skipped as unsampled'
    )
  })

  it('says every manifest was unsampled when none was pushed', () => {
    expect(
      pushSummary(0, { pushedManifests: 0, unsampledManifests: 2, runIds: [] })
    ).toBe(
      'pushed 0 test(s): all 2 manifest(s) were recorded under an unsampled TRACEPARENT'
    )
  })
})
