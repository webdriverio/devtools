import { getRequestType } from '@wdio/devtools-shared'
import { describe, it, expect } from 'vitest'

import { getRequestType as getRequestTypeViaCore } from '../src/request-type.js'
import { getRequestType as getRequestTypeViaNet } from '../src/net.js'

describe('getRequestType re-exports', () => {
  it('stay the one function shared defines, under both of core’s paths', () => {
    // Core's public API kept the name when the classifier moved to shared, and
    // `net.js` kept it from before the leaf-module split; neither is a copy.
    expect(getRequestTypeViaCore).toBe(getRequestType)
    expect(getRequestTypeViaNet).toBe(getRequestType)
  })
})
