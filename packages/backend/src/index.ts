import url from 'node:url'

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import staticServer from '@fastify/static'
import websocket from '@fastify/websocket'
import getPort from 'get-port'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'

import { getDevtoolsApp } from './utils.js'
import { DEFAULT_PORT } from './constants.js'
import { testRunner } from './runner.js'
import type { RunnerRequestBody } from './types.js'

let server: FastifyInstance | undefined

interface DevtoolsBackendOptions {
  port?: number
  hostname?: string
}

const log = logger('@wdio/devtools-backend')
const clients = new Set<WebSocket>()

export function broadcastToClients(message: string) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

export async function start(opts: DevtoolsBackendOptions = {}) {
  const host = opts.hostname || 'localhost'
  const port = opts.port || (await getPort({ port: DEFAULT_PORT }))
  const appPath = await getDevtoolsApp()

  server = Fastify({ logger: true })
  await server.register(websocket)
  await server.register(staticServer, {
    root: appPath
  })

  server.post(
    '/api/tests/run',
    async (request: FastifyRequest<{ Body: RunnerRequestBody }>, reply) => {
      const body = request.body
      if (!body?.uid || !body.entryType) {
        return reply.code(400).send({ error: 'Invalid run payload' })
      }
      try {
        await testRunner.run({
          ...body,
          devtoolsHost: host,
          devtoolsPort: port
        })
        return reply.send({ ok: true })
      } catch (error) {
        log.error(`Failed to start test run: ${(error as Error).message}`)
        return reply.code(500).send({ error: (error as Error).message })
      }
    }
  )

  server.post('/api/tests/stop', async (_request, reply) => {
    testRunner.stop()
    broadcastToClients(
      JSON.stringify({
        scope: 'testStopped',
        data: { stopped: true, timestamp: Date.now() }
      })
    )
    reply.send({ ok: true })
  })

  server.get(
    '/client',
    { websocket: true },
    (socket: WebSocket, _req: FastifyRequest) => {
      log.info('client connected')
      clients.add(socket)
      socket.on('close', () => clients.delete(socket))
    }
  )

  server.get(
    '/worker',
    { websocket: true },
    (socket: WebSocket, _req: FastifyRequest) => {
      socket.on('message', (message: Buffer) => {
        log.info(
          `received ${message.length} byte message from worker to ${clients.size} client${clients.size > 1 ? 's' : ''}`
        )
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message.toString())
          }
        })
      })
    }
  )

  log.info(`Starting WebdriverIO Devtools application on port ${port}`)
  await server.listen({ port, host })
  return server
}

export async function stop() {
  if (!server) {
    return
  }

  log.info('Shutting down WebdriverIO Devtools application')
  await server.close()
  clients.clear()
}

/**
 * start server if this file is called directly
 */
if (import.meta.url.startsWith('file:')) {
  const modulePath = url.fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    start()
  }
}
