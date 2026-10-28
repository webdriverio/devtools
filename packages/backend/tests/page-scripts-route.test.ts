/**
 * The page scripts an adapter that cannot import shared (the Python one) runs
 * against the collector and the Performance API. Served, so its copy cannot
 * drift from the strings the JS adapters import. Backend may not import core,
 * so this asserts against shared, and core's tests assert it re-exports the
 * same strings.
 */

import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  collectorDrainExpression,
  COLLECTOR_INJECT_SCRIPT,
  COLLECTOR_READY_SCRIPT,
  PAGE_SCRIPTS_API,
  PAGE_SCRIPTS_CONTENT_TYPE,
  type PageScriptsResponse
} from '@wdio/devtools-shared'
import { start } from '../src/index.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

let server: FastifyInstance | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  vi.restoreAllMocks()
})

async function fetchPageScripts() {
  vi.mocked(utils.getDevtoolsApp).mockResolvedValue(os.tmpdir())
  vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  server = (await start({ port: 0 })).server
  return server.inject({ method: 'GET', url: PAGE_SCRIPTS_API.get })
}

describe('page scripts route', () => {
  it('is generated into the Python contract from this path', () => {
    expect(PAGE_SCRIPTS_API.get).toBe('/api/page-scripts')
  })

  it('serves exactly the strings the JS adapters run', async () => {
    const response = await fetchPageScripts()

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe(PAGE_SCRIPTS_CONTENT_TYPE)
    expect(response.json<PageScriptsResponse>()).toStrictEqual({
      collectorReady: COLLECTOR_READY_SCRIPT,
      collectorInject: COLLECTOR_INJECT_SCRIPT,
      collectorDrain: collectorDrainExpression(true),
      capturePerformance: CAPTURE_PERFORMANCE_SCRIPT
    })
  })

  // The forced anchor is why the drain is served at all: an unforced drain
  // right after a navigation reads an empty buffer and the document is lost.
  it('serves the drain that anchors the current document first', async () => {
    const { collectorDrain } = (
      await fetchPageScripts()
    ).json<PageScriptsResponse>()

    expect(collectorDrain).toContain('captureCurrentDom()')
  })
})
