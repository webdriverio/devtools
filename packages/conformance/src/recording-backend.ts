import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { WebSocketServer } from 'ws'

import {
  COLLECTOR_API,
  COLLECTOR_CONTENT_TYPE,
  ELEMENT_SCRIPTS_API,
  PAGE_SCRIPTS_API,
  PAGE_SCRIPTS_CONTENT_TYPE,
  WS_PATHS,
  buildPageScripts
} from '@wdio/devtools-shared'

import { COLLECTOR_BUNDLE } from './constants.js'
import type { WireFrame } from './types.js'

/** Stands in for the dashboard: records every worker-socket frame in arrival order and stubs the routes adapters fetch. */
export class RecordingBackend {
  readonly host = '127.0.0.1'
  readonly port: number
  readonly frames: WireFrame[] = []
  #server: Server
  #wss: WebSocketServer

  private constructor(server: Server, wss: WebSocketServer) {
    this.#server = server
    this.#wss = wss
    this.port = (server.address() as AddressInfo).port
  }

  static async start(): Promise<RecordingBackend> {
    const server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0]
      if (path === COLLECTOR_API.get) {
        // The real bundle, as the real backend serves it, so every adapter injects the same collector.
        readFile(COLLECTOR_BUNDLE, 'utf8').then(
          (source) => {
            res.writeHead(200, { 'content-type': COLLECTOR_CONTENT_TYPE })
            res.end(source)
          },
          () => res.writeHead(404).end()
        )
      } else if (path === PAGE_SCRIPTS_API.get) {
        // Real, not stubbed: these are the probe, injection and drain the fake WebDriver recognises.
        res.writeHead(200, { 'content-type': PAGE_SCRIPTS_CONTENT_TYPE })
        res.end(JSON.stringify(buildPageScripts()))
      } else if (path === ELEMENT_SCRIPTS_API.get) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ accessibilityTree: 'null', elements: '[]' }))
      } else {
        res.writeHead(404).end()
      }
    })
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      if ((req.url ?? '').split('?')[0] !== WS_PATHS.worker) {
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const backend = new RecordingBackend(server, wss)
    wss.on('connection', (ws) => {
      ws.on('message', (raw) =>
        backend.frames.push(JSON.parse(String(raw)) as WireFrame)
      )
    })
    return backend
  }

  close(): Promise<void> {
    for (const client of this.#wss.clients) {
      client.terminate()
    }
    this.#wss.close()
    return new Promise((r) => this.#server.close(() => r()))
  }
}
