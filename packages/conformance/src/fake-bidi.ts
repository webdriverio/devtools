import type { Server } from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

import { BIDI_PATH } from './constants.js'
import type { BidiCommandHandler } from './types.js'

interface Command {
  id: number
  method: string
  params?: Record<string, unknown>
}

/** A BiDi endpoint over the fake browser: `onCommand` answers every command, and no events are emitted. */
export function attachFakeBidi(
  server: Server,
  onCommand: BidiCommandHandler
): () => void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== BIDI_PATH) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => answer(ws, onCommand))
  })
  return () => {
    for (const client of wss.clients) {
      client.terminate()
    }
    wss.close()
  }
}

function answer(ws: WebSocket, onCommand: BidiCommandHandler): void {
  ws.on('message', async (raw) => {
    const { id, method, params } = JSON.parse(String(raw)) as Command
    const reply = await onCommand(method, params ?? {})
    ws.send(
      JSON.stringify(
        'error' in reply
          ? { type: 'error', id, error: reply.error, message: reply.message }
          : { type: 'success', id, result: reply.result }
      )
    )
  })
}

/** A script result in BiDi's remote-value form, as a browser serialises what a function returned. */
export function remoteValue(value: unknown): Record<string, unknown> {
  if (value === null) {
    return { type: 'null' }
  }
  if (value === undefined) {
    return { type: 'undefined' }
  }
  if (Array.isArray(value)) {
    return { type: 'array', value: value.map(remoteValue) }
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      value: Object.entries(value).map(([key, v]) => [key, remoteValue(v)])
    }
  }
  return { type: typeof value, value }
}
