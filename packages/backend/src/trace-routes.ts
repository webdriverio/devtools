import fs from 'node:fs'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  TRACE_API,
  traceZipUrl,
  type TracePlayerData,
  type TraceRunListing
} from '@wdio/devtools-shared'

import type { TraceRunFile } from './trace-files.js'

/** What trace-serve mode serves: one reconstructed trace, or a run of zips the app reads itself. */
export interface TraceServe {
  trace?: TracePlayerData
  traceRun?: readonly TraceRunFile[]
}

const ZIP_RATE_FLOOR = 100
const ZIP_LOADS_PER_MINUTE = 5

function listing(run: readonly TraceRunFile[]): TraceRunListing {
  return {
    traces: run.map(({ path }, index) => ({ path, url: traceZipUrl(index) }))
  }
}

// Only an index into the list fixed at startup reaches the disk, never a path from the request.
function listedFile(
  run: readonly TraceRunFile[] | undefined,
  index: string
): string | undefined {
  if (!run || !/^\d+$/.test(index)) {
    return undefined
  }
  return run[Number(index)]?.file
}

export function registerTraceRoutes(
  s: FastifyInstance,
  { trace, traceRun }: TraceServe
): void {
  // Always registered so live mode gets a definitive 204 here instead of a 404
  // from the static handler: the app probes this on boot to choose between
  // player and live-WS mode, and a 204 keeps the common (live) path quiet.
  s.get(TRACE_API.get, async (_request, reply) =>
    trace ? reply.send(trace) : reply.code(204).send()
  )
  s.get(TRACE_API.run, async (_request, reply) =>
    traceRun ? reply.send(listing(traceRun)) : reply.code(204).send()
  )
  s.get(
    TRACE_API.zip,
    {
      // The app fetches every listed zip once per page load, so a large run would exhaust the global limit.
      config: {
        rateLimit: {
          max: Math.max(
            ZIP_RATE_FLOOR,
            (traceRun?.length ?? 0) * ZIP_LOADS_PER_MINUTE
          ),
          timeWindow: '1 minute'
        }
      }
    },
    async (request: FastifyRequest<{ Params: { index: string } }>, reply) => {
      const file = listedFile(traceRun, request.params.index)
      if (!file) {
        return reply.code(404).send({ error: 'Trace not found' })
      }
      return reply.type('application/zip').send(fs.createReadStream(file))
    }
  )
}
