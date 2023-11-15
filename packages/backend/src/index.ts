import url from 'node:url'

import Fastify, { type FastifyInstance } from 'fastify'
import staticServer from '@fastify/static'
import getPort from 'get-port'

import { getDevtoolsApp } from './utils.js'
import { DEFAULT_PORT } from './constants.js'

let server: FastifyInstance | undefined

interface DevtoolsBackendOptions {
  port?: number
}

export async function start (opts: DevtoolsBackendOptions = {}) {
  const port = opts.port || await getPort({ port: DEFAULT_PORT })
  const appPath = await getDevtoolsApp()

  server = Fastify({ logger: true })
  server.register(staticServer, {
    root: appPath
  })

  // Run the server!
  try {
    await server.listen({ port })
    console.log(`WebdriverIO Devtools started on port ${port}`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

export async function stop () {
  if (!server) {
    return
  }

  await server.close()
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = url.fileURLToPath(import.meta.url)
  if (process.argv[1] === modulePath) {
    start()
  }
}
