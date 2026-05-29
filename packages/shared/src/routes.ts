/**
 * WebSocket upgrade paths on the backend's Fastify server. Each adapter opens
 * one socket at `worker`; one or more browser tabs subscribe at `client`.
 *
 * The HTTP API endpoints under `/api/baseline/*` live in `./baseline.ts`.
 */
export const WS_PATHS = {
  /** Adapter session upgrade endpoint. One socket per running adapter. */
  worker: '/worker',
  /** App/UI client upgrade endpoint. Multiple browser tabs may connect. */
  client: '/client'
} as const
