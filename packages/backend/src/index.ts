import fs from 'node:fs'
import url from 'node:url'

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import staticServer from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
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

// Notify the worker when a UI client connects so the plugin can unblock
// Builder.build() instead of finishing the run before the dashboard appears.
let workerSocket: WebSocket | undefined

// sessionId → absolute path of the encoded .webm; queried by /api/video/:sessionId.
const videoRegistry = new Map<string, string>()

// Replay buffer for clients connecting after the worker has already streamed.
// Required for plugins where the dashboard window spawns asynchronously and
// may attach after a fast run has already completed.
const MESSAGE_BUFFER_LIMIT = 10000
const messageBuffer: string[] = []

export function broadcastToClients(message: string) {
  messageBuffer.push(message)
  if (messageBuffer.length > MESSAGE_BUFFER_LIMIT) {
    messageBuffer.shift()
  }
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  })
}

function replayBufferedMessages(socket: WebSocket) {
  for (const msg of messageBuffer) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(msg)
    }
  }
}

function serveVideo(sessionId: string, reply: any) {
  const videoPath = videoRegistry.get(sessionId)
  if (!videoPath) {
    return reply.code(404).send({ error: 'Video not found' })
  }
  if (!fs.existsSync(videoPath)) {
    return reply.code(404).send({ error: 'Video file missing from disk' })
  }
  return reply
    .header('Content-Type', 'video/webm')
    .send(fs.createReadStream(videoPath))
}

export async function start(
  opts: DevtoolsBackendOptions = {}
): Promise<{ server: FastifyInstance; port: number }> {
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
  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  })
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
      log.info(
        `client connected (replaying ${messageBuffer.length} buffered message(s))`
      )
      replayBufferedMessages(socket)
      clients.add(socket)
      socket.on('close', () => {
        clients.delete(socket)
        // Last dashboard window closed — tell the worker so it can wind
        // down. Lets the user close Chrome to end an interactive review
        // session under any runner.
        if (clients.size === 0 && workerSocket?.readyState === WebSocket.OPEN) {
          workerSocket.send(
            JSON.stringify({ scope: 'clientDisconnected', data: {} })
          )
        }
      })

      if (workerSocket?.readyState === WebSocket.OPEN) {
        workerSocket.send(
          JSON.stringify({ scope: 'clientConnected', data: {} })
        )
      }
    }
  )

  server.get(
    '/worker',
    { websocket: true },
    (socket: WebSocket, _req: FastifyRequest) => {
      // Drop the message buffer for a fresh run (so late dashboards don't
      // replay stale state) but NOT for a rerun child — the dashboard's
      // mergeSuite/mergeTests dedupe by uid, and the existing tree should
      // stay rendered while sibling tests freeze at their last result.
      const isRerunChild = testRunner.consumeRerunChildFlag()
      if (!isRerunChild) {
        messageBuffer.length = 0
      }
      workerSocket = socket
      socket.on('close', () => {
        if (workerSocket === socket) {
          workerSocket = undefined
        }
      })
      if (clients.size > 0) {
        socket.send(JSON.stringify({ scope: 'clientConnected', data: {} }))
      }
      socket.on('message', (message: Buffer) => {
        // Use `debug` — at `info` level this feeds the worker's stream
        // capture and creates a backend↔capture loop.
        log.debug(
          `received ${message.length} byte message from worker to ${clients.size} client${clients.size > 1 ? 's' : ''}`
        )

        try {
          const parsed = JSON.parse(message.toString())

          if (parsed.scope === 'clearCommands') {
            const testUid = parsed.data?.testUid
            log.info(`Clearing commands for test: ${testUid || 'all'}`)
            broadcastToClients(
              JSON.stringify({
                scope: 'clearExecutionData',
                data: { uid: testUid }
              })
            )
            return
          }

          if (parsed.scope === 'config' && parsed.data?.configFile) {
            testRunner.registerConfigFile(parsed.data.configFile)
            log.info(
              `Registered config file for reruns: ${parsed.data.configFile}`
            )
            return
          }

          // Intercept screencast messages: store the absolute videoPath in the
          // registry (backend-only), then forward only the sessionId to the UI
          // so the UI can request the video via GET /api/video/:sessionId.
          if (parsed.scope === 'screencast' && parsed.data?.sessionId) {
            const { sessionId, videoPath } = parsed.data
            if (videoPath) {
              videoRegistry.set(sessionId, videoPath)
              log.info(
                `Screencast registered for session ${sessionId}: ${videoPath}`
              )
            }
            broadcastToClients(
              JSON.stringify({
                scope: 'screencast',
                data: { sessionId }
              })
            )
            return
          }
        } catch {
          // Not JSON or parsing failed, forward as-is
        }

        // Forward all other messages as-is
        broadcastToClients(message.toString())
      })
    }
  )

  server.get(
    '/api/video/:sessionId',
    {
      preHandler: server.rateLimit({
        max: 30,
        timeWindow: '1 minute'
      })
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply
    ) => {
      const { sessionId } = request.params
      return serveVideo(sessionId, reply)
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
    if (
      client.readyState === WebSocket.OPEN ||
      client.readyState === WebSocket.CONNECTING
    ) {
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
