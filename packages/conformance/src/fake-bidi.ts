import type { Server } from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

import { BIDI_PATH, BIDI_RESULTS } from './constants.js'

interface Command {
  id: number
  method: string
}

/** A BiDi endpoint that acknowledges every command and emits no events; reports a preload registration. */
export function attachFakeBidi(
  server: Server,
  onPreload: () => void
): () => void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== BIDI_PATH) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => answer(ws, onPreload))
  })
  return () => {
    for (const client of wss.clients) {
      client.terminate()
    }
    wss.close()
  }
}

function answer(ws: WebSocket, onPreload: () => void): void {
  ws.on('message', (raw) => {
    const { id, method } = JSON.parse(String(raw)) as Command
    if (method === 'script.addPreloadScript') {
      onPreload()
    }
    ws.send(
      JSON.stringify({
        type: 'success',
        id,
        result: BIDI_RESULTS[method] ?? {}
      })
    )
  })
}
