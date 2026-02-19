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

export async function start(opts: DevtoolsBackendOptions = {}): Promise<{ server: FastifyInstance; port: number }> {
  const host = opts.hostname || 'localhost'
  // Use getPort to find an available port, starting with the preferred port
  const preferredPort = opts.port || DEFAULT_PORT
  const port = await getPort({ port: preferredPort })

  // Log if we had to use a different port
  if (opts.port && port !== opts.port) {
    log.warn(`Port ${opts.port} is already in use, using port ${port} instead`)
  }

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

        // Parse message to check if it's a clearCommands message
        try {
          const parsed = JSON.parse(message.toString())

          // If this is a clearCommands message, transform it to clear-execution-data format
          if (parsed.scope === 'clearCommands') {
            const testUid = parsed.data?.testUid
            log.info(`Clearing commands for test: ${testUid || 'all'}`)

            // Create a synthetic message that DataManager will understand
            const clearMessage = JSON.stringify({
              scope: 'clearExecutionData',
              data: { uid: testUid }
            })

            clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(clearMessage)
              }
            })
            return
          }
        } catch (e) {
          // Not JSON or parsing failed, forward as-is
        }

        // Forward all other messages as-is
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
  return { server, port }
}

export async function stop() {
  if (!server) {
    return
  }

  log.info('Shutting down WebdriverIO Devtools application')

  // Close all WebSocket connections first
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.terminate()
    }
  })
  clients.clear()

  await server.close()
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
