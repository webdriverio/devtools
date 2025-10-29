import url from 'node:url'

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import staticServer from '@fastify/static'
import websocket from '@fastify/websocket'
import getPort from 'get-port'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'

import { getDevtoolsApp } from './utils.js'
import { DEFAULT_PORT } from './constants.js'

let server: FastifyInstance | undefined

interface DevtoolsBackendOptions {
  port?: number
  hostname?: string
}

const log = logger('@wdio/devtools-backend')
const clients = new Set<WebSocket>()

export async function start(opts: DevtoolsBackendOptions = {}) {
  const host = opts.hostname || 'localhost'
  const port = opts.port || (await getPort({ port: DEFAULT_PORT }))
  const appPath = await getDevtoolsApp()

  server = Fastify({ logger: true })
  await server.register(websocket)
  await server.register(staticServer, {
    root: appPath
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
