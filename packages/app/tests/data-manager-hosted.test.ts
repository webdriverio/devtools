// @vitest-environment happy-dom
//
// The hosted trace player has no backend: the trace is a file the viewer picks,
// parsed in the tab. These tests open a zip produced by the real writer, the
// same bytes an adapter leaves on disk, so writer and hosted reader are
// checked against each other rather than against a hand-built fixture.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { TraceType } from '@wdio/devtools-shared'
// eslint-disable-next-line no-restricted-imports -- builds a zip as an adapter does; app source never writes one
import { writeTraceZip } from '@wdio/devtools-trace/trace-exporter'
// eslint-disable-next-line no-restricted-imports -- as above
import { buildTraceZip } from '@wdio/devtools-trace/trace-zip-writer'

import { CACHE_ID } from '../src/controller/constants.js'
import { DataManagerController } from '../src/controller/DataManager.js'

vi.mock('../src/controller/constants.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  HOSTED_PLAYER: true
}))

class StubHost extends HTMLElement implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = []

  addController(controller: ReactiveController) {
    this.controllers.push(controller)
  }

  removeController() {}

  requestUpdate() {}

  get updateComplete(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
customElements.define('hosted-data-manager-stub-host', StubHost)

const dirs: string[] = []
let fetches: string[]
let sockets: string[]

function boot(): DataManagerController {
  const host = document.createElement(
    'hosted-data-manager-stub-host'
  ) as StubHost
  document.body.appendChild(host)
  const manager = new DataManagerController(host)
  manager.hostConnected()
  return manager
}

async function recordedTrace(): Promise<Blob> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-trace-'))
  dirs.push(outputDir)
  const zip = await writeTraceZip(
    {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        { command: 'url', args: ['https://example.com'], timestamp: 2000 },
        { command: 'click', args: ['#login'], timestamp: 3000 }
      ],
      sources: new Map(),
      metadata: { type: TraceType.Testrunner, sessionId: 'abc12345' },
      startWallTime: 1000
    },
    { outputDir, sessionId: 'abc12345' }
  )
  return new Blob([new Uint8Array(await fs.readFile(zip))])
}

beforeEach(() => {
  fetches = []
  sockets = []
  localStorage.clear()
  document.body.innerHTML = ''
  vi.stubGlobal('fetch', (url: string) => {
    fetches.push(String(url))
    return Promise.reject(new Error('no backend'))
  })
  vi.stubGlobal(
    'WebSocket',
    class {
      constructor(url: string) {
        sockets.push(url)
      }
    }
  )
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

describe('the hosted trace player', () => {
  it('reaches for no backend before a file is opened', async () => {
    const manager = boot()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetches).toEqual([])
    expect(sockets).toEqual([])
    expect(manager.hasConnection).toBe(false)
  })

  it('plays a trace.zip the viewer opened', async () => {
    const manager = boot()

    await manager.openTraceArchive(await recordedTrace())

    expect(manager.playerMode).toBe(true)
    expect(manager.hasConnection).toBe(true)
    expect(
      manager.commandsContextProvider.value.map(({ command }) => command)
    ).toEqual(['url', 'click'])
    expect(manager.metadataContextProvider.value?.sessionId).toBe('abc12345')
  })

  it('keeps the opened trace out of browser storage', async () => {
    const manager = boot()

    await manager.openTraceArchive(await recordedTrace())

    expect(localStorage.getItem(CACHE_ID)).toBeNull()
  })

  it('refuses a file that is not a zip', async () => {
    const manager = boot()

    await expect(
      manager.openTraceArchive(new Blob(['not a zip']))
    ).rejects.toThrow('Not a readable trace')
    expect(manager.hasConnection).toBe(false)
  })

  it('refuses a zip that holds no trace', async () => {
    const manager = boot()
    const zip = await buildTraceZip({
      traceNdjson: '',
      networkNdjson: Buffer.alloc(0),
      resources: []
    })

    await expect(
      manager.openTraceArchive(new Blob([new Uint8Array(zip)]))
    ).rejects.toThrow('No trace found in this archive')
    expect(manager.hasConnection).toBe(false)
  })
})
