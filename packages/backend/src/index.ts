import url from 'node:url'

import Fastify, { type FastifyInstance } from 'fastify'
import staticServer from '@fastify/static'
import getPort from 'get-port'
import logger from '@wdio/logger'

import { getDevtoolsApp } from './utils.js'
import { DEFAULT_PORT } from './constants.js'

let server: FastifyInstance | undefined

interface DevtoolsBackendOptions {
  port?: number
}

const log = logger('@wdio/devtools-backend')

export async function start (opts: DevtoolsBackendOptions = {}) {
  const port = opts.port || await getPort({ port: DEFAULT_PORT })
  const appPath = await getDevtoolsApp()

  server = Fastify({ logger: true })
  server.register(staticServer, {
    root: appPath
  })

  log.info(`Starting WebdriverIO Devtools application on port ${port}`)
  await server.listen({ port })
  return server
}

export async function stop () {
  if (!server) {
    return
  }

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
