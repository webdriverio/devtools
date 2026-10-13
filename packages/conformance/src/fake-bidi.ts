import type { Server } from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

import { BIDI_PATH, BIDI_RESULTS, COLLECTOR_SIGNATURE } from './constants.js'

interface Command {
  id: number
  method: string
  params?: { functionDeclaration?: string }
}

/** A BiDi endpoint that acknowledges every command and emits no events; reports when the collector is registered as a preload. */
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
    const { id, method, params } = JSON.parse(String(raw)) as Command
    // Only the collector's own source counts; an unrelated preload instruments nothing.
    if (
      method === 'script.addPreloadScript' &&
      COLLECTOR_SIGNATURE.test(params?.functionDeclaration ?? '')
    ) {
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
