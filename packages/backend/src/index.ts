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
import { createWorkerMessageHandler } from './worker-message-handler.js'
import { resolveByteRange } from './video-range.js'
import {
  BASELINE_API,
  BASELINE_WS_SCOPE,
  WS_PATHS,
  WS_SCOPE,
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
//
// `parentWorkerSocket` is the long-lived worker (the original test runner
// holding the keep-alive on shutdown). `workerSocket` tracks whichever worker
// most recently connected — typically a rerun child while it runs. Outbound
// signals like `clientDisconnected` go to the PARENT, otherwise a closed
// rerun-child leaves the parent unreachable and `clientDisconnected` is lost.
let workerSocket: WebSocket | undefined
let parentWorkerSocket: WebSocket | undefined

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

function serveVideo(
  sessionId: string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const videoPath = videoRegistry.get(sessionId)
  if (!videoPath) {
    return reply.code(404).send({ error: 'Video not found' })
  }
  if (!fs.existsSync(videoPath)) {
    return reply.code(404).send({ error: 'Video file missing from disk' })
  }
  const total = fs.statSync(videoPath).size
  reply.header('Content-Type', 'video/webm')
  // Range support is what makes the <video> seekable — without a 206 the
  // browser plays linearly but `video.seekable` stays empty and any
  // currentTime set snaps back to 0. The scrubber/markers depend on it.
  reply.header('Accept-Ranges', 'bytes')

  const range = resolveByteRange(request.headers.range, total)
  if (range.kind === 'unsatisfiable') {
    return reply.code(416).header('Content-Range', `bytes */${total}`).send()
  }
  if (range.kind === 'full') {
    reply.header('Content-Length', total)
    return reply.send(fs.createReadStream(videoPath))
  }
  const { start, end } = range
  return reply
    .code(206)
    .header('Content-Range', `bytes ${start}-${end}/${total}`)
    .header('Content-Length', end - start + 1)
    .send(fs.createReadStream(videoPath, { start, end }))
}

async function handleTestRun(
  body: RunnerRequestBody,
  host: string,
  port: number,
  reply: FastifyReply
): Promise<FastifyReply> {
  if (!body?.uid || !body.entryType) {
    return reply.code(400).send({ error: 'Invalid run payload' })
  }
  // Broadcast a clear so popouts (which only see WS events) wipe too.
  broadcastToClients(
    JSON.stringify({
      scope: WS_SCOPE.clearExecutionData,
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
    await testRunner.run({ ...body, devtoolsHost: host, devtoolsPort: port })
    return reply.send({ ok: true })
  } catch (error) {
    log.error(`Failed to start test run: ${(error as Error).message}`)
    return reply.code(500).send({ error: (error as Error).message })
  }
}

function registerTestRoutes(
  s: FastifyInstance,
  host: string,
  port: number
): void {
  s.post(
    '/api/tests/run',
    (request: FastifyRequest<{ Body: RunnerRequestBody }>, reply) =>
      handleTestRun(request.body, host, port, reply)
  )

  s.post('/api/tests/stop', async (_request, reply) => {
    testRunner.stop()
    broadcastToClients(
      JSON.stringify({
        scope: WS_SCOPE.testStopped,
        data: { stopped: true, timestamp: Date.now() }
      })
    )
    reply.send({ ok: true })
  })
}

async function handleBaselinePreserve(
  body: Partial<BaselinePreserveRequest>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { testUid, scope } = body || {}
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

async function handleBaselineClear(
  body: Partial<BaselineClearRequest>,
  reply: FastifyReply
): Promise<FastifyReply> {
  const { testUid } = body || {}
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

function registerBaselineRoutes(s: FastifyInstance): void {
  s.post(
    BASELINE_API.preserve,
    (
      request: FastifyRequest<{ Body: Partial<BaselinePreserveRequest> }>,
      reply
    ) => handleBaselinePreserve(request.body, reply)
  )
  s.post(
    BASELINE_API.clear,
    (request: FastifyRequest<{ Body: Partial<BaselineClearRequest> }>, reply) =>
      handleBaselineClear(request.body, reply)
  )
  s.get(
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
}

function handleClientWsClose(socket: WebSocket): void {
  clients.delete(socket)
  // Last dashboard window closed — tell the worker so it can wind down. Lets
  // the user close Chrome to end an interactive review session under any
  // runner. Route to the PARENT worker — it owns the keep-alive + shutdown
  // handler. The `workerSocket` ref may point at a rerun child that's about
  // to exit; falling back to `parentWorkerSocket` handles that (and a fresh
  // post-rerun click before the child fully closes).
  const target =
    parentWorkerSocket?.readyState === WebSocket.OPEN
      ? parentWorkerSocket
      : workerSocket?.readyState === WebSocket.OPEN
        ? workerSocket
        : undefined
  if (clients.size === 0 && target) {
    target.send(
      JSON.stringify({ scope: WS_SCOPE.clientDisconnected, data: {} })
    )
  }
}

function registerClientWebSocket(s: FastifyInstance): void {
  s.get(
    WS_PATHS.client,
    { websocket: true },
    (socket: WebSocket, _req: FastifyRequest) => {
      log.info(
        `client connected (replaying ${messageBuffer.length} buffered message(s))`
      )
      replayBufferedMessages(socket)
      clients.add(socket)
      socket.on('close', () => handleClientWsClose(socket))
      if (workerSocket?.readyState === WebSocket.OPEN) {
        workerSocket.send(
          JSON.stringify({ scope: WS_SCOPE.clientConnected, data: {} })
        )
      }
    }
  )
}

function registerWorkerWebSocket(s: FastifyInstance): void {
  s.get(
    WS_PATHS.worker,
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      // Don't drop the message buffer for rerun-child connects (the dashboard
      // tree dedupes by uid and stale state must survive). Same applies to
      // baselineStore.activeRun — keep it across reruns so Preserve & Rerun on
      // a different failed test still finds data; #updateNode handles window
      // expansion across reruns of the same test.
      const isRerunChild = testRunner.consumeRerunChildFlag()
      // A mid-run session-change reconnect (e.g. after `browser.end()`) reopens
      // this socket; keep the accumulated run state so earlier tests' commands
      // survive for Preserve & Rerun instead of being wiped.
      const isReconnect =
        (req.query as { reconnect?: string })?.reconnect === '1'
      if (!isRerunChild && !isReconnect) {
        messageBuffer.length = 0
        baselineStore.resetActiveRun()
      }
      workerSocket = socket
      if (!isRerunChild) {
        parentWorkerSocket = socket
      }
      socket.on('close', () => {
        if (workerSocket === socket) {
          workerSocket = undefined
        }
        if (parentWorkerSocket === socket) {
          parentWorkerSocket = undefined
        }
      })
      if (clients.size > 0) {
        socket.send(
          JSON.stringify({ scope: WS_SCOPE.clientConnected, data: {} })
        )
      }
      socket.on(
        'message',
        createWorkerMessageHandler({
          baselineStore,
          testRunner,
          videoRegistry,
          broadcastToClients,
          clientCount: () => clients.size
        })
      )
    }
  )
}

function registerVideoRoute(s: FastifyInstance): void {
  s.get(
    '/api/video/:sessionId',
    {
      preHandler: s.rateLimit({
        max: 30,
        timeWindow: '1 minute'
      })
    },
    async (
      request: FastifyRequest<{ Params: { sessionId: string } }>,
      reply
    ) => {
      return serveVideo(request.params.sessionId, request, reply)
    }
  )
}

export async function start(
  opts: DevtoolsBackendOptions = {}
): Promise<{ server: FastifyInstance; port: number }> {
  const host = opts.hostname || 'localhost'
  const preferredPort = opts.port || DEFAULT_PORT
  const port = await getPort({ port: preferredPort })
  if (opts.port && port !== opts.port) {
    log.warn(`Port ${opts.port} is already in use, using port ${port} instead`)
  }

  const appPath = await getDevtoolsApp()
  server = Fastify({ logger: true })
  await server.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await server.register(websocket)
  await server.register(staticServer, { root: appPath })

  registerTestRoutes(server, host, port)
  registerBaselineRoutes(server)
  registerClientWebSocket(server)
  registerWorkerWebSocket(server)
  registerVideoRoute(server)

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
