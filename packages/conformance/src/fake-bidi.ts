import type { Server } from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

import {
  BIDI_PATH,
  LOAD_MS,
  RESPONSE_BYTES,
  WINDOW_HANDLE
} from './constants.js'
import type { BidiCommandHandler } from './types.js'

interface Command {
  id: number
  method: string
  params?: Record<string, unknown>
}

/** The fake BiDi endpoint: answers every command, and emits an event to the clients subscribed to it. */
export interface FakeBidi {
  close(): void
  /** Delivers one event to every client that subscribed to its method; a client that never subscribed hears nothing, as in a browser. */
  emit(method: string, params: Record<string, unknown>): void
}

export function attachFakeBidi(
  server: Server,
  onCommand: BidiCommandHandler
): FakeBidi {
  const wss = new WebSocketServer({ noServer: true })
  const subscriptions = new Map<WebSocket, Set<string>>()
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== BIDI_PATH) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      subscriptions.set(ws, new Set())
      ws.on('close', () => subscriptions.delete(ws))
      answer(ws, onCommand, subscriptions.get(ws)!)
    })
  })
  return {
    close: () => {
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close()
    },
    emit: (method, params) => {
      for (const [ws, events] of subscriptions) {
        if (events.has(method) && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'event', method, params }))
        }
      }
    }
  }
}

function answer(
  ws: WebSocket,
  onCommand: BidiCommandHandler,
  subscribed: Set<string>
): void {
  ws.on('message', async (raw) => {
    const { id, method, params } = JSON.parse(String(raw)) as Command
    if (method === 'session.subscribe') {
      for (const event of (params?.events as string[] | undefined) ?? []) {
        subscribed.add(event)
      }
    }
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

const bidiHeader = (name: string, value: string) => ({
  name,
  value: { type: 'string', value }
})

const bidiRequest = (id: number, url: string, at: number) => ({
  request: `request-${id}`,
  url,
  method: 'GET',
  headers: [bidiHeader('accept', '*/*')],
  cookies: [],
  headersSize: 0,
  bodySize: 0,
  timings: {
    timeOrigin: at,
    requestTime: 0,
    redirectStart: 0,
    redirectEnd: 0,
    fetchStart: 0,
    dnsStart: 0,
    dnsEnd: 0,
    connectStart: 0,
    connectEnd: 0,
    tlsStart: 0,
    requestStart: 1,
    responseStart: LOAD_MS - 1,
    responseEnd: LOAD_MS
  }
})

/** One request as Chrome reports it over BiDi: the request, then its response with headers. */
export function networkEvents(
  id: number,
  url: string,
  mime: string,
  at: number
): Array<[string, Record<string, unknown>]> {
  const request = bidiRequest(id, url, at)
  const shared = {
    context: WINDOW_HANDLE,
    navigation: null,
    redirectCount: 0,
    isBlocked: false,
    timestamp: at
  }
  return [
    [
      'network.beforeRequestSent',
      { ...shared, request, initiator: { type: 'other' } }
    ],
    [
      'network.responseCompleted',
      {
        ...shared,
        request,
        response: {
          url,
          protocol: 'http/1.1',
          status: 200,
          statusText: 'OK',
          fromCache: false,
          headers: [bidiHeader('content-type', mime)],
          mimeType: mime,
          bytesReceived: RESPONSE_BYTES,
          headersSize: 0,
          bodySize: RESPONSE_BYTES,
          content: { size: RESPONSE_BYTES }
        }
      }
    ]
  ]
}
