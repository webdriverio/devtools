// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { TraceType, type LegacyTracePlayerData } from '@wdio/devtools-shared'

import { openLegacyTrace } from '../src/controller/legacy-trace.js'

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4o6EBAAMQAS0Qc/Z2AAAAAElFTkSuQmCC'

const payload = (): LegacyTracePlayerData => ({
  trace: {
    mutations: [],
    logs: [],
    consoleLogs: [],
    networkRequests: [],
    metadata: { type: TraceType.Standalone },
    commands: [],
    sources: {},
    pageResources: [
      {
        url: 'https://site.test/a.css',
        kind: 'stylesheet',
        mimeType: 'text/css',
        data: btoa('p{}'),
        size: 3
      }
    ]
  },
  frames: [
    { timestamp: 1, screenshot: ONE_PIXEL_PNG },
    { timestamp: 2 },
    { timestamp: 3, screenshot: btoa('second') }
  ],
  startTime: 1,
  duration: 2
})

describe('openLegacyTrace', () => {
  it('names each inline image by an in-memory entry the archive reads back', async () => {
    const { data, archive } = openLegacyTrace(payload())

    expect(data.frames.map(({ timestamp }) => timestamp)).toEqual([1, 3])
    expect(data.frameSize).toEqual({ width: 1, height: 1 })
    expect(await (await archive.read(data.frames[1]!.entry)).text()).toBe(
      'second'
    )
  })

  it('moves inline page resources onto entry refs', async () => {
    const { data, archive } = openLegacyTrace(payload())

    expect(data.trace.pageResources).toBeUndefined()
    const [resource] = data.pageResources!
    expect(resource).toMatchObject({ url: 'https://site.test/a.css', size: 3 })
    expect(await (await archive.read(resource!.entry)).text()).toBe('p{}')
  })

  it('refuses a name it does not hold, and everything once closed', async () => {
    const { data, archive } = openLegacyTrace(payload())

    await expect(archive.read('nope')).rejects.toThrow('no entry nope')
    archive.close()
    await expect(archive.read(data.frames[0]!.entry)).rejects.toThrow()
  })

  it('plays the actions of a payload that carries no frame list', () => {
    const { data } = openLegacyTrace({
      ...payload(),
      frames: undefined
    } as unknown as LegacyTracePlayerData)

    expect(data.frames).toEqual([])
    expect(data.frameBytes).toBeUndefined()
  })

  it('names the largest image as the frame size budget', () => {
    const { data } = openLegacyTrace(payload())

    expect(data.frameBytes).toBe(Math.floor((ONE_PIXEL_PNG.length * 3) / 4))
  })
})
