import fs from 'node:fs'
import url from 'node:url'

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify'
import staticServer from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import getPort from 'get-port'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'

import { getDevtoolsApp } from './utils.js'
import { DEFAULT_PORT } from './constants.js'
import { testRunner } from './runner.js'
import { baselineStore } from './baselineStore.js'
import {
  BASELINE_API,
  BASELINE_WS_SCOPE,
  WS_PATHS,
  type BaselinePreserveRequest,
  type BaselineClearRequest,
  type BaselineGetParams,
  type BaselineGetQuery,
  type BaselineSavedWsPayload,
  type BaselineClearedWsPayload
} from '@wdio/devtools-shared'
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

function serveVideo(sessionId: string, reply: FastifyReply) {
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
      // Broadcast a clear so popouts (which only see WS events) wipe too.
      broadcastToClients(
        JSON.stringify({
          scope: 'clearExecutionData',
          data: { uid: body.uid, entryType: body.entryType }
        })
      )
      // Plain Rerun hides the Compare tab by dropping all baselines.
      if (!body.preserveBaseline) {
        const clearedUids = baselineStore.clearAll()
        for (const testUid of clearedUids) {
          broadcastToClients(
            JSON.stringify({
              scope: BASELINE_WS_SCOPE.cleared,
              data: { testUid }
            })
          )
        }
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

  server.post(
    BASELINE_API.preserve,
    async (
      request: FastifyRequest<{ Body: Partial<BaselinePreserveRequest> }>,
      reply
    ) => {
      const { testUid, scope } = request.body || {}
      if (!testUid || (scope !== 'test' && scope !== 'suite')) {
        return reply.code(400).send({
          error: 'Invalid preserve payload: testUid and scope required'
        })
      }
      const attempt = baselineStore.preserve(testUid, scope)
      if (!attempt) {
        return reply
          .code(409)
          .send({ error: 'No captured data for the requested uid' })
      }
      const payload: BaselineSavedWsPayload = { testUid, attempt }
      broadcastToClients(
        JSON.stringify({ scope: BASELINE_WS_SCOPE.saved, data: payload })
      )
      return reply.send({ ok: true, attempt })
    }
  )

  server.post(
    BASELINE_API.clear,
    async (
      request: FastifyRequest<{ Body: Partial<BaselineClearRequest> }>,
      reply
    ) => {
      const { testUid } = request.body || {}
      if (!testUid) {
        return reply.code(400).send({ error: 'testUid required' })
      }
      const removed = baselineStore.clear(testUid)
      if (removed) {
        const payload: BaselineClearedWsPayload = { testUid }
        broadcastToClients(
          JSON.stringify({ scope: BASELINE_WS_SCOPE.cleared, data: payload })
        )
      }
      return reply.send({ ok: true, removed })
    }
  )

  server.get(
    BASELINE_API.get,
    async (
      request: FastifyRequest<{
        Params: BaselineGetParams
        Querystring: BaselineGetQuery
      }>,
      reply
    ) => {
      const { testUid } = request.params
      const scope = request.query.scope === 'suite' ? 'suite' : 'test'
      return reply.send(baselineStore.getPair(testUid, scope))
    }
  )

  server.get(
    WS_PATHS.client,
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
    WS_PATHS.worker,
    { websocket: true },
    (socket: WebSocket, _req: FastifyRequest) => {
      // Don't drop the message buffer for rerun-child connects (the dashboard
      // tree dedupes by uid and stale state must survive). Same applies to
      // baselineStore.activeRun — keep it across reruns so Preserve & Rerun on
      // a different failed test still finds data; #updateNode handles window
      // expansion across reruns of the same test.
      const isRerunChild = testRunner.consumeRerunChildFlag()
      if (!isRerunChild) {
        messageBuffer.length = 0
        baselineStore.resetActiveRun()
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
            // Mirror the dashboard's reset behavior: clearing without a uid
            // is a full reset, so wipe the baseline accumulator too.
            if (!testUid) {
              baselineStore.resetActiveRun()
            }
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
          // Tee the event into the baseline accumulator for time-window
          // partitioning at preserve time. Done after special-case handling
          // so we don't accumulate control frames (clearCommands, screencast).
          baselineStore.recordEvent(parsed.scope, parsed.data)
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
