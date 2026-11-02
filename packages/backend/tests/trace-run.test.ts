import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRACE_API, traceZipUrl } from '@wdio/devtools-shared'

import { start } from '../src/index.js'
import { collectTraceZips, traceRunFiles } from '../src/trace-files.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

vi.mock('ws')

let root: string

async function write(relative: string, body = relative): Promise<string> {
  const file = path.join(root, relative)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  return file
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'show-trace-run-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('collectTraceZips', () => {
  it('finds the zips anywhere under a folder and skips the rest', async () => {
    const login = await write('run/login-chrome/trace.zip')
    const logout = await write('run/logout-chrome/trace.zip')
    await write('run/login-chrome/screenshot.png')
    await write('run/artifacts.json')

    expect(await collectTraceZips(['run'], root)).toEqual([login, logout])
  })

  it('keeps a file named outright, for the reader to refuse if it must', async () => {
    const notes = await write('notes.txt')
    const zip = await write('one.zip')

    expect(await collectTraceZips(['notes.txt', 'one.zip'], root)).toEqual([
      notes,
      zip
    ])
  })

  it('lists a zip named twice once', async () => {
    const zip = await write('run/a/trace.zip')

    expect(await collectTraceZips(['run', 'run/a/trace.zip'], root)).toEqual([
      zip
    ])
  })

  it('fails on a path that does not exist', async () => {
    await expect(collectTraceZips(['missing'], root)).rejects.toThrow()
  })
})

describe('traceRunFiles', () => {
  it('names zips relative to where show-trace ran, and absolute outside it', () => {
    const inside = path.join(root, 'run', 'a', 'trace.zip')
    const outside = path.join(path.dirname(root), 'elsewhere.zip')

    expect(traceRunFiles([inside, outside], root)).toEqual([
      { file: inside, path: 'run/a/trace.zip' },
      { file: outside, path: outside.split(path.sep).join('/') }
    ])
  })
})

describe('trace-serve mode with several zips', () => {
  beforeEach(() => {
    vi.mocked(utils.getDevtoolsApp).mockResolvedValue('/mock/app/path')
    vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  })

  it('lists the zips and serves each one by its position', async () => {
    const a = await write('run/a/trace.zip', 'zip-a')
    const b = await write('run/b/trace.zip', 'zip-b')
    const { server } = await start({
      port: 0,
      traceRun: traceRunFiles([a, b], root)
    })

    const single = await server.inject({ method: 'GET', url: TRACE_API.get })
    const listing = await server.inject({ method: 'GET', url: TRACE_API.run })
    const second = await server.inject({ method: 'GET', url: traceZipUrl(1) })

    expect(single.statusCode).toBe(204)
    expect(listing.json()).toEqual({
      traces: [
        { path: 'run/a/trace.zip', url: '/api/trace/zip/0' },
        { path: 'run/b/trace.zip', url: '/api/trace/zip/1' }
      ]
    })
    expect(second.headers['content-type']).toBe('application/zip')
    expect(second.body).toBe('zip-b')
    await server.close()
  })

  it('serves nothing outside the listing', async () => {
    const a = await write('run/a/trace.zip')
    const { server } = await start({
      port: 0,
      traceRun: traceRunFiles([a], root)
    })

    for (const url of [
      traceZipUrl(1),
      '/api/trace/zip/-1',
      '/api/trace/zip/..%2F..%2Fetc%2Fpasswd'
    ]) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(404)
    }
    await server.close()
  })

  it('serves a run larger than the global rate limit in one page load', async () => {
    const files = await Promise.all(
      Array.from({ length: 120 }, (_, i) => write(`run/t${i}/trace.zip`))
    )
    const { server } = await start({
      port: 0,
      traceRun: traceRunFiles(files, root)
    })

    const statuses = await Promise.all(
      files.map(async (_, i) => {
        const res = await server.inject({ method: 'GET', url: traceZipUrl(i) })
        return res.statusCode
      })
    )

    expect(statuses.every((status) => status === 200)).toBe(true)
    await server.close()
  })

  it('answers 204 for the listing when it serves a live run', async () => {
    const { server } = await start({ port: 0 })

    const listing = await server.inject({ method: 'GET', url: TRACE_API.run })

    expect(listing.statusCode).toBe(204)
    await server.close()
  })
})
