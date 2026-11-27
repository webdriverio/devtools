import type { CommandLog } from '@wdio/devtools-shared'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { bytesZipSource } from '@wdio/devtools-trace/trace-reader'
import { MAX_SCREENSHOT_BYTES } from '../src/constants.js'
import { openTraceSource, traceStateOf } from '../src/open-trace.js'
import { traceScreenshot } from '../src/trace-screenshot.js'
import { traceSnapshot } from '../src/trace-snapshot.js'
import type { ScreenshotImage, TraceHandle } from '../src/types.js'
import { openNativeTrace } from './page-state-traces.js'
import { fixtures, openFixture } from './traces.js'

/** A 12x26 JPEG. */
const JPEG = Uint8Array.from(
  atob('/9j/4AAQSkZJRgABAQAAAQABAAD/wAALCAAaAAwBAREA/9oACAEBAAA/AP/Z'),
  (char) => char.charCodeAt(0)
)

function image(shot: unknown): ScreenshotImage {
  expect(shot).toHaveProperty('bytes')
  return shot as ScreenshotImage
}

describe('traceScreenshot on the older-writer fixtures', () => {
  it.each(fixtures.map(({ zipName }) => zipName))(
    'shows every action of %s the image of the capture its snapshot names',
    async (zipName) => {
      const trace = await openFixture(zipName)
      const { data, archive } = traceStateOf(trace)
      let compared = 0
      for (const { callId } of data.trace.commands) {
        const snapshot = traceSnapshot(trace, callId!)
        const shot = await traceScreenshot(trace, callId!)
        const claimed = data.snapshotSources?.[callId!]
        if (!snapshot || !claimed?.entry) {
          continue
        }
        expect(shot?.capture).toEqual(snapshot.capture)
        expect(image(shot).bytes).toEqual(await archive.read(claimed.entry))
        compared++
      }
      expect(compared).toBeGreaterThan(0)
    }
  )

  it('shows the first action of a screencast trace its own capture, not a frame', async () => {
    const trace = await openFixture('selenium-mocha-2026-11-10-ee505b9c.zip')
    const { archive } = traceStateOf(trace)
    const shot = image(await traceScreenshot(trace, 'call@3'))
    expect(shot.capture).toMatchObject({ callId: 'call@3', own: true })
    expect(shot.bytes).toEqual(
      await archive.read('resources/page@eff2f129-1794292630720.png')
    )
    expect(traceSnapshot(trace, 'call@3')?.capture).toEqual(shot.capture)
  })
})

/** A zip shaped like another tool's: screencast frames named `<page>-<ms>.jpeg`, and DOM snapshots whose overrides name page resources rather than a screenshot. */
async function openForeignTrace(): Promise<TraceHandle> {
  const event = (value: object) => JSON.stringify(value)
  const frame = (ms: number) => ({
    type: 'screencast-frame',
    pageId: 'page@6a1b',
    sha1: `page@6a1b-${1_700_000_000_000 + ms}.jpeg`,
    width: 12,
    height: 26,
    timestamp: ms
  })
  const action = (callId: string, start: number, end: number) => [
    {
      type: 'before',
      callId,
      startTime: start,
      class: 'Page',
      method: 'click',
      pageId: 'page@6a1b',
      params: {}
    },
    { type: 'after', callId, endTime: end, afterSnapshot: `after@${callId}` },
    {
      type: 'frame-snapshot',
      snapshot: {
        callId,
        snapshotName: `after@${callId}`,
        pageId: 'page@6a1b',
        frameId: 'frame@6a1b',
        frameUrl: 'https://site.example/',
        html: ['HTML', {}, ['BODY', {}, 'hi']],
        viewport: { width: 12, height: 26 },
        timestamp: end,
        wallTime: 1_700_000_000_000 + end,
        collectionTime: 0,
        resourceOverrides: [
          {
            url: 'https://site.example/a.css',
            sha1: `page@6a1b-${1_700_000_000_000 + end}.jpeg`
          }
        ],
        isMainFrame: true
      }
    }
  ]
  const lines = [
    {
      version: 8,
      type: 'context-options',
      browserName: 'chromium',
      wallTime: 1_700_000_000_000,
      monotonicTime: 0,
      title: 'foreign',
      options: {}
    },
    frame(150),
    frame(350),
    ...action('call@1', 100, 200),
    ...action('call@2', 300, 400),
    ...action('call@3', 50, 60)
  ].map(event)
  const zip = zipSync({
    'trace.trace': strToU8(lines.join('\n')),
    [`resources/page@6a1b-${1_700_000_000_150}.jpeg`]: JPEG,
    [`resources/page@6a1b-${1_700_000_000_350}.jpeg`]: JPEG
  })
  return openTraceSource(bytesZipSource(zip))
}

describe('traceScreenshot on a trace another tool wrote', () => {
  it('shows each action the latest screencast frame at or before it, credited to no action', async () => {
    const trace = await openForeignTrace()
    const { data } = traceStateOf(trace)
    expect(data.frames).toHaveLength(2)
    for (const [callId, at] of [
      ['call@1', 150],
      ['call@2', 350]
    ] as const) {
      expect(image(await traceScreenshot(trace, callId)).capture).toEqual({
        timeMs: at,
        own: false
      })
    }
  })

  it('returns nothing for an action before the first frame', async () => {
    const trace = await openForeignTrace()
    const first = traceStateOf(trace).data.trace.commands[0]!
    expect(first.callId).toBe('call@3')
    expect(await traceScreenshot(trace, 'call@3')).toBeUndefined()
  })
})

describe('traceScreenshot on a native app trace', () => {
  it('returns the stored image with the size to downscale it to', async () => {
    expect(
      await traceScreenshot(await openNativeTrace(), 'call@1')
    ).toMatchObject({
      callId: 'call@1',
      capture: { timeMs: 0, callId: 'call@1', own: true },
      mimeType: 'image/png',
      size: { width: 1080, height: 2400 },
      fit: { width: 461, height: 1024 },
      tokens: 630
    })
  })

  it("reports the same capture as the snapshot, for an action's own and for one it inherits", async () => {
    const trace = await openNativeTrace()
    for (const callId of ['call@1', 'call@2']) {
      expect((await traceScreenshot(trace, callId))?.capture).toEqual(
        traceSnapshot(trace, callId)?.capture
      )
    }
    expect((await traceScreenshot(trace, 'call@2'))?.capture).toEqual({
      timeMs: 0,
      callId: 'call@1',
      title: 'Element.click("~start")',
      own: false
    })
  })

  it('returns nothing for an action before the first capture, never a later frame', async () => {
    const commands: CommandLog[] = [
      { command: 'getText', args: ['~start'], startTime: 900, timestamp: 1000 },
      { command: 'click', args: ['~start'], startTime: 1800, timestamp: 2000 }
    ]
    const trace = await openNativeTrace(commands, [2000])
    expect(await traceScreenshot(trace, 'call@1')).toBeUndefined()
    expect(traceSnapshot(trace, 'call@1')).toBeUndefined()
    expect((await traceScreenshot(trace, 'call@2'))?.capture).toMatchObject({
      timeMs: 1000,
      callId: 'call@2',
      own: true
    })
  })

  it('says why no image came back when the stored one is over the read limit', async () => {
    const trace = await openNativeTrace()
    const { archive } = traceStateOf(trace)
    const sizeOf = archive.sizeOf.bind(archive)
    archive.sizeOf = (name: string) =>
      name.endsWith('.png') ? MAX_SCREENSHOT_BYTES + 1 : sizeOf(name)
    expect(await traceScreenshot(trace, 'call@1')).toEqual({
      callId: 'call@1',
      capture: expect.objectContaining({ callId: 'call@1', own: true }),
      unavailable: `The stored screenshot is ${MAX_SCREENSHOT_BYTES + 1} bytes, over the ${MAX_SCREENSHOT_BYTES}-byte read limit`
    })
  })

  it('fits within the edge it is asked for, never larger than the image', async () => {
    const trace = await openNativeTrace()
    expect(
      image(await traceScreenshot(trace, 'call@1', { maxEdge: 480 })).fit
    ).toEqual({ width: 216, height: 480 })
    expect(
      image(await traceScreenshot(trace, 'call@1', { maxEdge: 4000 })).fit
    ).toEqual({ width: 1080, height: 2400 })
  })

  it('counts the tokens of an image fitted past 1568 pixels at the size the API scales it to', async () => {
    const large = image(
      await traceScreenshot(await openNativeTrace(), 'call@1', {
        maxEdge: 4000
      })
    )
    expect(large.fit).toEqual({ width: 1080, height: 2400 })
    expect(large.tokens).toBe(1477)
  })

  it.each([0, -1, 1.5])('refuses maxEdge %s', async (maxEdge) => {
    await expect(
      traceScreenshot(await openNativeTrace(), 'call@1', { maxEdge })
    ).rejects.toThrow(/maxEdge/)
  })

  it('returns nothing for a trace with no frame', async () => {
    const trace = await openNativeTrace(undefined, [])
    expect(await traceScreenshot(trace, 'call@1')).toBeUndefined()
  })
})
