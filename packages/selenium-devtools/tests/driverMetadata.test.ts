import { describe, expect, it } from 'vitest'
import { buildDriverMetadata } from '../src/helpers/driverMetadata.js'
import { SELENIUM_RUNNER_ID } from '../src/constants.js'
import type { SeleniumDriverLike } from '../src/types.js'

function driverStub(sessionId = 'sess-1'): SeleniumDriverLike {
  return {
    getSession: () => Promise.resolve({ getId: () => sessionId }),
    getCapabilities: () =>
      Promise.resolve({ serialize: () => ({ browserName: 'chrome' }) })
  } as unknown as SeleniumDriverLike
}

async function metadataFor(detectedRunner: string | null) {
  const { metadata } = await buildDriverMetadata({
    driver: driverStub(),
    driverReadyTs: Date.now(),
    detectedRunner
  })
  return metadata as {
    runner?: string
    options?: { framework?: string; runCapabilities?: Record<string, boolean> }
  }
}

describe('buildDriverMetadata', () => {
  it('names the adapter on the typed `runner` field', async () => {
    // `runner` means TestRunnerId everywhere; the mocha/jest/cucumber value is
    // `detectedRunner` and must never leak into this field.
    const metadata = await metadataFor('mocha')

    expect(metadata?.runner).toBe(SELENIUM_RUNNER_ID)
  })

  it('leaves the same fact off `options.framework`', async () => {
    // One carrier per fact: the sidebar reads `Metadata.runner` and only falls
    // back to the option for zips recorded before that field existed.
    const metadata = await metadataFor('mocha')

    expect(metadata?.options?.framework).toBeUndefined()
  })

  it('derives run capabilities from the detected JS runner, not from `runner`', async () => {
    // Cucumber's `--name` filters scenarios but not Gherkin steps, so leaf-step
    // rerun stays disabled — a per-detectedRunner distinction the adapter-wide
    // `runner` value cannot make.
    expect((await metadataFor('cucumber'))?.options?.runCapabilities).toEqual({
      canRunSuites: true,
      canRunTests: false,
      canRunAll: true
    })
    expect((await metadataFor('mocha'))?.options?.runCapabilities).toEqual({
      canRunSuites: true,
      canRunTests: true,
      canRunAll: true
    })
  })

  it('returns no metadata when the driver cannot be queried', async () => {
    const { sessionId, metadata } = await buildDriverMetadata({
      driver: {
        getSession: () => Promise.reject(new Error('no such session'))
      } as unknown as SeleniumDriverLike,
      driverReadyTs: Date.now(),
      detectedRunner: 'mocha'
    })

    expect(sessionId).toBeUndefined()
    expect(metadata).toBeUndefined()
  })
})
