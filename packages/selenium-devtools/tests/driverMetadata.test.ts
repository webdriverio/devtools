import { describe, expect, it } from 'vitest'
import { buildDriverMetadata } from '../src/helpers/driverMetadata.js'
import { SELENIUM_RUNNER_ID } from '../src/constants.js'
import type { SeleniumDriverLike } from '../src/types.js'

/**
 * Shaped like selenium's own `Capabilities`: the data lives in a private Map
 * reachable through `keys()`/`get()`, and `serialize` exists only under a
 * Symbol. A stub with a string-keyed `serialize()` — which is what this used
 * to be — validates a shape no driver has ever had.
 */
function capabilitiesStub(bag: Record<string, unknown>) {
  const map = new Map(Object.entries(bag))
  return { keys: () => map.keys(), get: (key: string) => map.get(key) }
}

function driverStub(
  sessionId = 'sess-1',
  bag: Record<string, unknown> = { browserName: 'chrome' }
): SeleniumDriverLike {
  return {
    getSession: () => Promise.resolve({ getId: () => sessionId }),
    getCapabilities: () => Promise.resolve(capabilitiesStub(bag))
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

/**
 * `Capabilities` keeps its data in a private Map and exposes `serialize` only
 * under a Symbol, so the instance reached the dashboard as `{"map_":{}}` — no
 * device on the trace, a guessed browser name, and an empty capabilities pane.
 */
describe('buildDriverMetadata capability serialization', () => {
  const NATIVE = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': '/app.apk'
  }

  it('flattens the driver capabilities into a readable bag', async () => {
    const { metadata } = await buildDriverMetadata({
      driver: driverStub('sess-1', NATIVE),
      driverReadyTs: Date.now(),
      detectedRunner: 'mocha'
    })

    expect(metadata?.capabilities).toEqual(NATIVE)
  })

  it('survives the JSON round trip that carries it upstream', async () => {
    const { metadata } = await buildDriverMetadata({
      driver: driverStub('sess-1', NATIVE),
      driverReadyTs: Date.now(),
      detectedRunner: 'mocha'
    })

    expect(
      JSON.parse(JSON.stringify({ capabilities: metadata?.capabilities }))
        .capabilities
    ).toEqual(NATIVE)
  })

  it('reads a bag that is already plain', async () => {
    const { metadata } = await buildDriverMetadata({
      driver: {
        getSession: () => Promise.resolve({ getId: () => 'sess-2' }),
        getCapabilities: () => Promise.resolve({ browserName: 'firefox' })
      } as unknown as SeleniumDriverLike,
      driverReadyTs: Date.now(),
      detectedRunner: 'mocha'
    })

    expect(metadata?.capabilities).toEqual({ browserName: 'firefox' })
  })
})
