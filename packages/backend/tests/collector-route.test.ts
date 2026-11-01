import { describe, it, expect } from 'vitest'
import { COLLECTOR_API, COLLECTOR_CONTENT_TYPE } from '@wdio/devtools-shared'
import { getCollectorSource } from '../src/utils.js'

describe('collector source', () => {
  // Adapters used to locate this on disk, which only works inside a checkout.
  // The backend depends on the package, so it can hand out the same bundle to
  // any adapter, in any language, wherever it was installed from.
  it('reads the collector out of the package the backend depends on', async () => {
    const source = await getCollectorSource()

    expect(source).toContain('wdioTraceCollector')
    expect(source.length).toBeGreaterThan(1000)
  })

  it('serves it as JavaScript from a path both sides agree on', () => {
    // The Python adapter generates this path into `_contract.py` from shared,
    // so a rename here fails its drift check rather than 404ing at runtime.
    expect(COLLECTOR_API.get).toBe('/api/collector')
    expect(COLLECTOR_CONTENT_TYPE).toContain('javascript')
  })
})
