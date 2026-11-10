import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { playerCsp, TRACE_API } from '@wdio/devtools-shared'

import { start } from '../src/index.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn(),
  getCollectorSource: vi.fn()
}))

let server: FastifyInstance | undefined
let appDir: string | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
  if (appDir) {
    fs.rmSync(appDir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

async function serve() {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-app-'))
  fs.writeFileSync(
    path.join(appDir, 'index.html'),
    '<!doctype html><title>x</title>'
  )
  vi.mocked(utils.getDevtoolsApp).mockResolvedValue(appDir)
  vi.mocked(utils.getCollectorSource).mockResolvedValue('// collector')
  server = (await start({ port: 0 })).server
  return server
}

// show-trace and the live dashboard replay recorded pages too, so they need the hosted player's policy.
describe('the dashboard page the backend serves', () => {
  it('carries the player CSP, with the socket of the host it was asked on', async () => {
    const app = await serve()

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost:3000' }
    })

    expect(response.headers['content-security-policy']).toBe(
      playerCsp(['ws://localhost:3000'])
    )
  })

  it('reflects no socket for a Host header that is not a plain host', async () => {
    const app = await serve()

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'evil.test; script-src *' }
    })

    expect(response.headers['content-security-policy']).toBe(playerCsp())
  })

  it('leaves API responses without it', async () => {
    const app = await serve()

    const response = await app.inject({ method: 'GET', url: TRACE_API.run })

    expect(response.headers['content-security-policy']).toBeUndefined()
  })
})
