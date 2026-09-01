/**
 * Building a trace from the run the backend already accumulates.
 *
 * The transforms themselves are covered in packages/trace. What matters here is
 * the adaptation: that every stream the accumulator holds reaches the artifact,
 * that the suite tree becomes test metadata, and that a run with nothing in it
 * declines rather than writing an artifact that reads as a run which captured
 * nothing.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  TRACE_EVENT_TYPES,
  TRACE_ZIP_ENTRIES,
  type Metadata
} from '@wdio/devtools-shared'
import {
  exportActiveRunTrace,
  hasExportableData,
  testMetadataFromNodes
} from '../src/trace-export.js'
import { freshRun } from '../src/baseline/utils.js'
import type { ActiveRun, TimeWindowNode } from '../src/baseline/types.js'

/** Smallest valid JPEG — the exporter content-addresses frame bytes, so they
 *  have to be real image data rather than a placeholder string. */
const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
  )
})

async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-export-'))
  dirs.push(dir)
  return dir
}

function run(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    ...freshRun(),
    commands: [
      { command: 'url', args: ['https://x/login'], timestamp: 1100 },
      { command: 'click', args: ['#go'], timestamp: 1200 }
    ],
    ...overrides
  }
}

function node(overrides: Partial<TimeWindowNode> = {}): TimeWindowNode {
  return { uid: 't1', kind: 'test', childUids: [], ...overrides }
}

/** Read `trace.trace` out of the written zip as parsed NDJSON lines. */
async function traceEvents(
  zipPath: string
): Promise<Record<string, unknown>[]> {
  const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
  const entry = files[TRACE_ZIP_ENTRIES.trace]
  if (!entry) {
    throw new Error(
      `no ${TRACE_ZIP_ENTRIES.trace} in zip; entries: ${Object.keys(files).join(', ')}`
    )
  }
  return strFromU8(entry)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

describe('testMetadataFromNodes', () => {
  it('keeps tests and drops suites — only a test names a tracing group', () => {
    const nodes = new Map<string, TimeWindowNode>([
      ['s1', node({ uid: 's1', kind: 'suite', title: 'Login' })],
      ['t1', node({ uid: 't1', title: 'logs in', file: '/login.spec.py' })]
    ])
    const meta = testMetadataFromNodes(nodes)
    expect([...meta.keys()]).toEqual(['t1'])
    expect(meta.get('t1')).toEqual({
      title: 'logs in',
      specFile: '/login.spec.py'
    })
  })

  it('falls back through fullTitle to the uid so a group is never nameless', () => {
    const nodes = new Map<string, TimeWindowNode>([
      ['t1', node({ uid: 't1', fullTitle: 'Login logs in' })],
      ['t2', node({ uid: 't2' })]
    ])
    const meta = testMetadataFromNodes(nodes)
    expect(meta.get('t1')?.title).toBe('Login logs in')
    expect(meta.get('t2')?.title).toBe('t2')
  })

  it('carries state when the node reported one, and omits the key otherwise', () => {
    const nodes = new Map<string, TimeWindowNode>([
      ['t1', node({ uid: 't1', state: 'failed' })],
      ['t2', node({ uid: 't2' })]
    ])
    const meta = testMetadataFromNodes(nodes)
    expect(meta.get('t1')?.state).toBe('failed')
    expect(meta.get('t2')).not.toHaveProperty('state')
  })
})

describe('hasExportableData', () => {
  it('is true when any of the three primary streams carries something', () => {
    expect(hasExportableData(run())).toBe(true)
    expect(
      hasExportableData(
        run({
          commands: [],
          consoleLogs: [{ type: 'log', args: ['hi'], timestamp: 1 }]
        })
      )
    ).toBe(true)
    expect(
      hasExportableData(
        run({
          commands: [],
          networkRequests: [
            {
              id: 'r1',
              url: 'https://x/a',
              method: 'GET',
              type: 'other',
              startTime: 1,
              timestamp: 1
            }
          ]
        })
      )
    ).toBe(true)
  })

  // Mutations and sources alone are not a run: the collector anchors a DOM on
  // page load, so a session that opened a page and did nothing else would
  // otherwise produce an artifact with no actions in it.
  it('is false for an empty run and for one carrying only page-side noise', () => {
    expect(hasExportableData(run({ commands: [] }))).toBe(false)
    expect(
      hasExportableData(
        run({
          commands: [],
          mutations: [
            {
              type: 'childList',
              addedNodes: [],
              removedNodes: [],
              timestamp: 1
            }
          ],
          sources: { '/a.py': 'x = 1' }
        })
      )
    ).toBe(false)
  })
})

describe('exportActiveRunTrace', () => {
  it('writes a zip whose actions are the accumulated commands', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(run(), {
      outputDir,
      sessionId: 'sess-1'
    })

    expect(zipPath).toBe(path.join(outputDir, 'trace-sess-1.zip'))
    const methods = (await traceEvents(zipPath))
      .filter((e) => e.type === 'before')
      .map((e) => e.method)
    // `url` normalizes to `navigate` through shared's action map — the
    // artifact records what the action IS, not what the adapter called it.
    expect(methods).toContain('navigate')
    expect(methods).toContain('click')
  })

  it('carries console, network and sources into the artifact', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        consoleLogs: [
          { type: 'error', args: ['boom'], timestamp: 1150, source: 'browser' }
        ],
        networkRequests: [
          {
            id: 'r1',
            url: 'https://x/app.css',
            method: 'GET',
            type: 'stylesheet',
            status: 200,
            startTime: 1100,
            timestamp: 1120
          }
        ],
        sources: { '/login.spec.py': 'def test_login(): pass' }
      }),
      { outputDir, sessionId: 'sess-2' }
    )

    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const names = Object.keys(files)
    expect(names).toContain(TRACE_ZIP_ENTRIES.network)
    expect(strFromU8(files[TRACE_ZIP_ENTRIES.network]!)).toContain('app.css')
    const trace = strFromU8(files[TRACE_ZIP_ENTRIES.trace]!)
    expect(trace).toContain('boom')
  })

  it("names tracing groups from the run's suite tree", async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        commands: [
          { command: 'click', args: ['#go'], timestamp: 1200, testUid: 't1' }
        ],
        nodes: new Map([
          ['t1', node({ uid: 't1', title: 'logs in', file: '/login.spec.py' })]
        ])
      }),
      { outputDir, sessionId: 'sess-3' }
    )

    const groups = (await traceEvents(zipPath)).filter(
      (e) => e.method === 'tracingGroup'
    )
    expect(JSON.stringify(groups)).toContain('logs in')
  })

  it('puts the metadata frame the worker sent into the artifact', async () => {
    const outputDir = await tmpDir()
    const metadata = {
      sessionId: 'sess-4',
      capabilities: { browserName: 'chrome' }
    } as unknown as Metadata
    const zipPath = await exportActiveRunTrace(run({ metadata }), {
      outputDir,
      sessionId: 'sess-4'
    })

    const options = (await traceEvents(zipPath)).filter(
      (e) => e.type === TRACE_EVENT_TYPES.contextOptions
    )
    expect(options).toHaveLength(1)
    expect(JSON.stringify(options[0])).toContain('chrome')
  })

  // The A11y tab reads these. Given none, the exporter synthesizes bare
  // snapshots from commands carrying screenshots — a picture per action and no
  // elements, which is what a Python trace had: 16 frame snapshots, 0
  // *-elements.json, against 12 in a JS Selenium trace of the same flow.
  it('writes the element tree beside an action when one was streamed', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        actionSnapshots: [
          {
            timestamp: 1200,
            command: 'clickElement',
            screenshot: JPEG_1PX,
            elements: [{ selector: '#go', role: 'button', name: 'Go' }]
          }
        ]
      }),
      { outputDir, sessionId: 'sess-a11y' }
    )

    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const elements = Object.keys(files).filter((n) =>
      n.endsWith('-elements.json')
    )
    expect(elements).toHaveLength(1)
    expect(strFromU8(files[elements[0]!]!)).toContain('#go')
  })

  // An adapter exporting through here captures the tree with a page-side
  // script but cannot serialize it — that transform is TypeScript. Capturing
  // only `elements` left the A11y tab reporting "no accessibility snapshot"
  // with 39 element files in the same archive.
  it('serializes a raw accessibility tree into the text the A11y tab parses', async () => {
    const outputDir = await tmpDir()
    const node = (
      role: string,
      name: string,
      selector: string,
      depth: number
    ) => ({
      role,
      name,
      selector,
      depth,
      level: '',
      disabled: '',
      checked: '',
      expanded: '',
      selected: '',
      pressed: '',
      required: '',
      readonly: '',
      isInViewport: true
    })
    const zipPath = await exportActiveRunTrace(
      run({
        actionSnapshots: [
          {
            timestamp: 1200,
            command: 'clickElement',
            url: 'https://x/login',
            title: 'The Internet',
            screenshot: JPEG_1PX,
            accessibilityTree: [node('button', 'Login', '#go', 0)]
          }
        ]
      }),
      { outputDir, sessionId: 'sess-tree' }
    )

    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const snap = Object.keys(files).find((n) => n.endsWith('-snapshot.txt'))
    expect(snap).toBeDefined()
    const text = strFromU8(files[snap!]!)
    expect(text).toContain('The Internet')
    expect(text).toContain('button "Login"')
  })

  // The JS adapters serialize in-process; theirs is authoritative.
  it('leaves a snapshotText the sender already produced alone', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        actionSnapshots: [
          {
            timestamp: 1200,
            command: 'clickElement',
            screenshot: JPEG_1PX,
            snapshotText: 'ALREADY SERIALIZED',
            accessibilityTree: [
              {
                role: 'button',
                name: 'Login',
                selector: '#go',
                depth: 0,
                level: '',
                disabled: '',
                checked: '',
                expanded: '',
                selected: '',
                pressed: '',
                required: '',
                readonly: ''
              }
            ]
          }
        ]
      }),
      { outputDir, sessionId: 'sess-keep' }
    )

    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const snap = Object.keys(files).find((n) => n.endsWith('-snapshot.txt'))
    expect(strFromU8(files[snap!]!)).toBe('ALREADY SERIALIZED')
  })

  it('still writes a picture per action when none were streamed', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        commands: [
          {
            command: 'clickElement',
            args: ['#go'],
            timestamp: 1200,
            screenshot: JPEG_1PX
          }
        ]
      }),
      { outputDir, sessionId: 'sess-bare' }
    )

    const files = unzipSync(new Uint8Array(await fs.readFile(zipPath)))
    const names = Object.keys(files)
    expect(names.filter((n) => n.endsWith('-elements.json'))).toEqual([])
    expect(names.some((n) => n.endsWith('.jpeg'))).toBe(true)
  })

  // The JS adapters hand their recorder's buffer straight to the exporter
  // in-process; an adapter exporting through the backend has to send it, so the
  // frames arrive as a stream and have to survive the round trip into the zip.
  it('writes the dense filmstrip when frames were streamed', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(
      run({
        screencastFrames: [
          { data: JPEG_1PX, timestamp: 1100 },
          { data: JPEG_1PX, timestamp: 1200 }
        ]
      }),
      { outputDir, sessionId: 'sess-film' }
    )

    const events = await traceEvents(zipPath)
    const frames = events.filter(
      (e) => e.type === TRACE_EVENT_TYPES.screencastFrame
    )
    expect(frames.length).toBeGreaterThan(0)
  })

  // Absence means "no dense filmstrip", which keeps the sparse per-action one.
  // Passing an empty array instead would be a different thing to the exporter.
  it('writes no screencast-frame events when none were streamed', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(run(), {
      outputDir,
      sessionId: 'sess-nofilm'
    })

    const frames = (await traceEvents(zipPath)).filter(
      (e) => e.type === TRACE_EVENT_TYPES.screencastFrame
    )
    expect(frames).toEqual([])
  })

  it('honours fileStem so a per-test slice can name its own artifact', async () => {
    const outputDir = await tmpDir()
    const zipPath = await exportActiveRunTrace(run(), {
      outputDir,
      sessionId: 'sess-5',
      fileStem: 'trace'
    })
    expect(path.basename(zipPath)).toBe('trace.zip')
  })

  it('refuses a run with nothing captured rather than writing an empty artifact', async () => {
    const outputDir = await tmpDir()
    await expect(
      exportActiveRunTrace(run({ commands: [] }), {
        outputDir,
        sessionId: 'sess-6'
      })
    ).rejects.toThrow(/nothing captured/)
    expect(await fs.readdir(outputDir)).toEqual([])
  })
})
