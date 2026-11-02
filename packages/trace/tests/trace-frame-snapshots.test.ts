import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  buildActionEvents,
  buildImageFrameSnapshots,
  buildScreenshotResourceSnapshots,
  exportTraceZip,
  FrameSnapshotIndex,
  screenshotUrl,
  type AfterEvent,
  type FrameSnapshotEvent,
  type FrameSnapshotRef,
  type ScreencastFrameEvent,
  type ScreenshotResourceEvent
} from '@wdio/devtools-trace'
import { parseTraceZip } from '../src/trace-reader.js'
import {
  TraceType,
  type ActionSnapshot,
  type CommandLog
} from '@wdio/devtools-shared'

function snap(overrides: Partial<ActionSnapshot> = {}): ActionSnapshot {
  return {
    timestamp: 2000,
    command: 'click',
    screenshot: 'AAAA',
    ...overrides
  }
}

describe('FrameSnapshotIndex', () => {
  it('claims a snapshot by exact command timestamp and names it after@<callId>', () => {
    const index = new FrameSnapshotIndex([snap()])
    expect(index.claimAfter(2000, 'call@2')).toBe('after@call@2')
    expect(index.refs()).toEqual([
      { callId: 'call@2', snapshotName: 'after@call@2', snapshot: snap() }
    ])
  })

  it('returns undefined when the index holds no captures at all', () => {
    const index = new FrameSnapshotIndex([])
    expect(index.claimAfter(1234, 'call@2')).toBeUndefined()
    expect(index.refs()).toEqual([])
  })

  it('shares one capture across actions completing at the same instant', () => {
    // Nightwatch emits its native assertion rows in a batch whose execution
    // windows collapse onto one instant; consuming left the rest blank.
    const index = new FrameSnapshotIndex([snap()])
    expect(index.claimAfter(2000, 'call@2')).toBe('after@call@2')
    expect(index.claimAfter(2000, 'call@3')).toBe('after@call@3')
    expect(index.refs().map((r) => r.callId)).toEqual(['call@2', 'call@3'])
    expect(index.refs()[1]!.snapshot).toEqual(snap())
  })

  it('falls back to the most recent capture before an uncaptured action', () => {
    // An assertion reads the page rather than changing it, so it takes no
    // capture of its own and inherits the preceding action's.
    const index = new FrameSnapshotIndex([
      snap(),
      snap({ timestamp: 3000, command: 'setValue', screenshot: 'BB' })
    ])
    expect(index.claimAfter(3500, 'call@9')).toBe('after@call@9')
    expect(index.refs()[0]!.snapshot.screenshot).toBe('BB')
  })

  it('still returns nothing for an action preceding every capture', () => {
    const index = new FrameSnapshotIndex([snap()])
    expect(index.claimAfter(1000, 'call@1')).toBeUndefined()
    expect(index.refs()).toEqual([])
  })

  it('ignores snapshots without a screenshot', () => {
    const index = new FrameSnapshotIndex([snap({ screenshot: undefined })])
    expect(index.claimAfter(2000, 'call@2')).toBeUndefined()
  })

  it('keeps the richest capture for duplicate timestamps', () => {
    const index = new FrameSnapshotIndex([
      snap({ screenshot: 'AA' }),
      snap({ screenshot: 'AAAAAAAA' }),
      snap({ screenshot: 'AAAA' })
    ])
    index.claimAfter(2000, 'call@2')
    expect(index.refs()[0]!.snapshot.screenshot).toBe('AAAAAAAA')
  })

  it('tracks the last claimed name as the next action before state', () => {
    const index = new FrameSnapshotIndex([
      snap(),
      snap({ timestamp: 3000, command: 'setValue' })
    ])
    expect(index.beforeName()).toBeUndefined()
    index.claimAfter(2000, 'call@2')
    expect(index.beforeName()).toBe('after@call@2')
    index.claimAfter(3000, 'call@3')
    expect(index.beforeName()).toBe('after@call@3')
  })

  it('exposes element rects by timestamp regardless of screenshot', () => {
    const index = new FrameSnapshotIndex([
      snap({ screenshot: undefined, elements: [{ selector: '#go' }] })
    ])
    expect(index.elementsAt(2000)).toEqual([{ selector: '#go' }])
    expect(index.elementsAt(9999)).toBeUndefined()
  })

  it('keeps the richest element set for duplicate timestamps', () => {
    const index = new FrameSnapshotIndex([
      snap({ elements: [{ selector: 'a' }] }),
      snap({ elements: [{ selector: 'a' }, { selector: 'b' }] })
    ])
    expect(index.elementsAt(2000)).toHaveLength(2)
  })
})

describe('input point synthesis (A8)', () => {
  const wallTime = 1000
  const box = { x: 10, y: 20, width: 40, height: 10 }

  function pointOf(commands: CommandLog[], snaps: ActionSnapshot[]) {
    const events = buildActionEvents(
      commands,
      'page@abc',
      wallTime,
      undefined,
      new FrameSnapshotIndex(snaps)
    )
    const after = events.find((e) => e.type === 'after') as
      AfterEvent | undefined
    return after?.point
  }

  it('sets after.point to the matched element rect centre for a pointer action', () => {
    const point = pointOf(
      [{ command: 'click', args: ['#go'], timestamp: 2000, startTime: 1950 }],
      [snap({ elements: [{ selector: '#go', boundingBox: box }] })]
    )
    expect(point).toEqual({ x: 30, y: 25 })
  })

  it('resolves the point from the row locator when args carry none', () => {
    // Selenium acts through a resolved element handle — the receiver, not an
    // argument — so `args` holds no locator and `selector` is the only evidence.
    const point = pointOf(
      [{ command: 'click', args: [], selector: '#go', timestamp: 2000 }],
      [snap({ elements: [{ selector: '#go', boundingBox: box }] })]
    )
    expect(point).toEqual({ x: 30, y: 25 })
  })

  it('prefers the row locator over a fill value sitting in args[0]', () => {
    const point = pointOf(
      [
        {
          command: 'sendKeys',
          args: ['tomsmith'],
          selector: '#username',
          timestamp: 2000
        }
      ],
      [snap({ elements: [{ selector: '#username', boundingBox: box }] })]
    )
    expect(point).toEqual({ x: 30, y: 25 })
  })

  it('omits the point when the selector is absent from captured elements', () => {
    const point = pointOf(
      [{ command: 'click', args: ['#go'], timestamp: 2000, startTime: 1950 }],
      [snap({ elements: [{ selector: '#other', boundingBox: box }] })]
    )
    expect(point).toBeUndefined()
  })

  it('omits the point for non-pointer commands', () => {
    const point = pointOf(
      [{ command: 'getText', args: ['#go'], timestamp: 2000, startTime: 1950 }],
      [
        snap({
          command: 'getText',
          elements: [{ selector: '#go', boundingBox: box }]
        })
      ]
    )
    expect(point).toBeUndefined()
  })
})

describe('buildImageFrameSnapshots', () => {
  const pageId = 'page@abc123'
  const wallTime = 1000
  const viewport = { width: 800, height: 600 }

  function ref(overrides: Partial<ActionSnapshot> = {}): FrameSnapshotRef {
    return {
      callId: 'call@2',
      snapshotName: 'after@call@2',
      snapshot: snap(overrides)
    }
  }

  it('emits events with exactly the reference field set', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    expect(Object.keys(event!)).toEqual(['type', 'snapshot'])
    expect(event!.type).toBe('frame-snapshot')
    expect(Object.keys(event!.snapshot).sort()).toEqual(
      [
        'callId',
        'collectionTime',
        'doctype',
        'frameId',
        'frameUrl',
        'html',
        'isMainFrame',
        'pageId',
        'resourceOverrides',
        'snapshotName',
        'timestamp',
        'viewport',
        'wallTime'
      ].sort()
    )
  })

  it('references the stored screenshot from an image document in node-array format', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ url: 'https://example.test/login' })],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.html).toEqual([
      'HTML',
      {},
      ['HEAD', {}, ['BASE', { href: 'https://example.test/login' }]],
      [
        'BODY',
        { style: 'margin:0' },
        [
          'IMG',
          {
            src: 'https://screenshot.wdio-devtools.invalid/action.jpeg',
            style: 'display:block;width:100vw;height:100vh;object-fit:contain'
          }
        ]
      ]
    ])
  })

  it('stamps identity, timing, and frame fields from the ref', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    const s = event!.snapshot
    expect(s.callId).toBe('call@2')
    expect(s.snapshotName).toBe('after@call@2')
    expect(s.pageId).toBe(pageId)
    expect(s.frameId).toBe('frame@abc123')
    expect(s.doctype).toBe('html')
    expect(s.viewport).toEqual(viewport)
    expect(s.timestamp).toBe(1000)
    expect(s.wallTime).toBe(2000)
    expect(s.collectionTime).toBe(0)
    expect(s.resourceOverrides).toEqual([
      {
        url: 'https://screenshot.wdio-devtools.invalid/action.jpeg',
        sha1: 'page@abc123-2000.jpeg'
      }
    ])
    expect(s.isMainFrame).toBe(true)
  })

  it('gives a png screenshot its own url, sniffed from the base64 magic', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ screenshot: 'iVBORw0KGgo' })],
      pageId,
      wallTime,
      viewport
    )
    const html = JSON.stringify(event!.snapshot.html)
    expect(html).toContain(
      'https://screenshot.wdio-devtools.invalid/action.png'
    )
    expect(event!.snapshot.resourceOverrides[0]!.url).toBe(
      'https://screenshot.wdio-devtools.invalid/action.png'
    )
  })

  it('never inlines the screenshot bytes', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ screenshot: 'iVBORw0KGgoAAAANSUhEUg' })],
      pageId,
      wallTime,
      viewport
    )
    const json = JSON.stringify(event)
    expect(json).not.toContain('data:')
    expect(json).not.toContain('iVBORw0KGgoAAAANSUhEUg')
  })

  it('falls back to about:blank when the snapshot has no url', () => {
    const [event] = buildImageFrameSnapshots(
      [ref()],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.frameUrl).toBe('about:blank')
  })

  it('clamps timestamps captured before wallTime to zero', () => {
    const [event] = buildImageFrameSnapshots(
      [ref({ timestamp: 500 })],
      pageId,
      wallTime,
      viewport
    )
    expect(event!.snapshot.timestamp).toBe(0)
    expect(event!.snapshot.wallTime).toBe(500)
  })
})

describe('buildScreenshotResourceSnapshots', () => {
  const pageId = 'page@abc123'

  function ref(callId: string, snapshot: ActionSnapshot): FrameSnapshotRef {
    return { callId, snapshotName: `after@${callId}`, snapshot }
  }

  it('records one response per screenshot url, served from the first stored screenshot', () => {
    const events = buildScreenshotResourceSnapshots(
      [
        ref('call@1', snap({ timestamp: 2000, screenshot: 'iVBORw0KGgo1' })),
        ref('call@2', snap({ timestamp: 3000, screenshot: 'iVBORw0KGgo2' })),
        ref('call@3', snap({ timestamp: 4000, screenshot: '/9j/4AAQ' }))
      ],
      pageId
    )
    expect(
      events.map((e) => [
        e.snapshot.request.url,
        e.snapshot.response.content.mimeType,
        e.snapshot.response.content._sha1
      ])
    ).toEqual([
      [
        'https://screenshot.wdio-devtools.invalid/action.png',
        'image/png',
        'page@abc123-2000.png'
      ],
      [
        'https://screenshot.wdio-devtools.invalid/action.jpeg',
        'image/jpeg',
        'page@abc123-4000.jpeg'
      ]
    ])
  })

  it('is a GET recorded before any snapshot, in the snapshot frame', () => {
    // The viewer serves only a GET whose time precedes the snapshot, and the
    // first snapshot of a trace is commonly at time 0.
    const [event] = buildScreenshotResourceSnapshots(
      [ref('call@1', snap())],
      pageId
    )
    expect(event!.type).toBe('resource-snapshot')
    expect(event!.snapshot.request.method).toBe('GET')
    expect(event!.snapshot.response.status).toBe(200)
    expect(event!.snapshot._monotonicTime).toBeLessThan(0)
    expect(event!.snapshot._frameref).toBe('frame@abc123')
    expect(event!.snapshot.pageref).toBe(pageId)
  })

  it('records nothing when no screenshot is referenced', () => {
    expect(buildScreenshotResourceSnapshots([], pageId)).toEqual([])
  })
})

describe('a written trace stores each screenshot once', () => {
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const JPEG =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGBwkI'

  async function written() {
    const zip = await exportTraceZip(
      {
        mutations: [],
        logs: [],
        consoleLogs: [],
        networkRequests: [],
        metadata: { type: TraceType.Standalone },
        commands: [
          { command: 'url', args: ['https://example.test'], timestamp: 1000 },
          { command: 'click', args: ['#go'], timestamp: 2000 },
          { command: 'getText', args: ['#out'], timestamp: 3000 }
        ],
        sources: {},
        actionSnapshots: [
          { timestamp: 1000, command: 'url', screenshot: PNG },
          {
            timestamp: 2000,
            command: 'click',
            screenshot: JPEG,
            snapshotText: '- button "Go"'
          }
        ]
      },
      { sessionId: 'abc12345' }
    )
    const files = unzipSync(zip)
    const events = strFromU8(files['trace.trace']!)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string })
    return { zip, files, events }
  }

  it('writes no image bytes into the frame-snapshot events', async () => {
    const { events } = await written()
    const frameSnapshots = events.filter((e) => e.type === 'frame-snapshot')
    expect(frameSnapshots).toHaveLength(3)
    const json = JSON.stringify(frameSnapshots)
    expect(json).not.toContain('data:image')
    expect(json).not.toContain(PNG)
    expect(json).not.toContain(JPEG)
  })

  it('points every override at a stored resource the src and a recorded response both name', async () => {
    const { files, events } = await written()
    const responses = events.filter(
      (e) => e.type === 'resource-snapshot'
    ) as ScreenshotResourceEvent[]
    const responseUrls = responses.map((r) => r.snapshot.request.url)
    for (const response of responses) {
      expect(
        files[`resources/${response.snapshot.response.content._sha1}`]
      ).toBeDefined()
    }
    const frameSnapshots = events.filter(
      (e) => e.type === 'frame-snapshot'
    ) as FrameSnapshotEvent[]
    for (const { snapshot } of frameSnapshots) {
      const [override] = snapshot.resourceOverrides
      expect(snapshot.resourceOverrides).toHaveLength(1)
      expect(files[`resources/${override!.sha1}`]).toBeDefined()
      expect(JSON.stringify(snapshot.html)).toContain(
        `"src":"${override!.url}"`
      )
      expect(responseUrls).toContain(override!.url)
    }
    // The getText row inherits the click's capture, and so its stored file.
    expect(
      frameSnapshots.map((e) => e.snapshot.resourceOverrides[0]!.sha1)
    ).toEqual([
      'page@abc12345-1000.png',
      'page@abc12345-2000.jpeg',
      'page@abc12345-2000.jpeg'
    ])
    expect(responseUrls).toEqual([screenshotUrl(PNG), screenshotUrl(JPEG)])
  })

  it('names each screenshot by its own format in every place that names it', async () => {
    const { files, events } = await written()
    const stored = Object.keys(files)
      .filter((name) => /\.(png|jpeg)$/.test(name))
      .sort()
    expect(stored).toEqual([
      'resources/page@abc12345-1000.png',
      'resources/page@abc12345-2000.jpeg'
    ])
    const filmstrip = (
      events.filter(
        (e) => e.type === 'screencast-frame'
      ) as ScreencastFrameEvent[]
    ).map((e) => e.sha1)
    const overrides = (
      events.filter((e) => e.type === 'frame-snapshot') as FrameSnapshotEvent[]
    ).map((e) => e.snapshot.resourceOverrides[0]!.sha1)
    const responses = (
      events.filter(
        (e) => e.type === 'resource-snapshot'
      ) as ScreenshotResourceEvent[]
    ).map((e) => e.snapshot.response.content)
    for (const name of [
      ...filmstrip,
      ...overrides,
      ...responses.map((c) => c._sha1)
    ]) {
      expect(stored).toContain(`resources/${name}`)
    }
    expect(new Set(filmstrip)).toEqual(new Set(overrides))
    expect(responses.map((c) => [c.mimeType, c._sha1])).toEqual([
      ['image/png', 'page@abc12345-1000.png'],
      ['image/jpeg', 'page@abc12345-2000.jpeg']
    ])
  })

  it('reads back unchanged, with the screenshot responses kept out of the network rows', async () => {
    const { zip } = await written()
    const data = parseTraceZip(zip)
    expect(data.trace.networkRequests).toEqual([])
    expect(data.trace.commands.map((c) => c.command)).toEqual([
      'url',
      'click',
      'getText'
    ])
    expect(data.frames.map((f) => f.screenshot)).toEqual([PNG, JPEG])
    expect(data.trace.commands[1]!.snapshotText).toBe('- button "Go"')
  })

  it('still reads a zip written when every screenshot was named .jpeg', async () => {
    const { files } = await written()
    const legacy: Record<string, Uint8Array> = {}
    for (const [name, data] of Object.entries(files)) {
      legacy[name.replace(/\.png$/, '.jpeg')] = data
    }
    legacy['trace.trace'] = strToU8(
      strFromU8(files['trace.trace']!).replaceAll(
        'page@abc12345-1000.png',
        'page@abc12345-1000.jpeg'
      )
    )
    expect(legacy['resources/page@abc12345-1000.jpeg']).toBeDefined()
    expect(Object.keys(legacy).some((name) => name.endsWith('.png'))).toBe(
      false
    )

    const data = parseTraceZip(zipSync(legacy))
    expect(data.frames.map((f) => f.screenshot)).toEqual([PNG, JPEG])
    expect(data.trace.commands.map((c) => c.screenshot)).toEqual([
      PNG,
      JPEG,
      JPEG
    ])
  })
})
