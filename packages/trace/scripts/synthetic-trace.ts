// A trace of many large incompressible frames, the shape that makes reading a zip whole expensive; shared by the reader's tests and `measure-reader.ts`.

import { randomBytes } from 'node:crypto'

import {
  buildTraceZip,
  type TraceZipResource
} from '../src/trace-zip-writer.js'

const WALL_TIME = 1_700_000_000_000

/** A JPEG frame header naming 1280x720, then incompressible bytes, as a real capture's entropy-coded data is. */
function jpegFrame(bytes: number): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00
  ])
  return Buffer.concat([header, randomBytes(bytes - header.length)])
}

/** A trace of `frames` screencast frames of `frameBytes` each, one action per ten frames. */
export async function syntheticTraceZip({
  frames = 300,
  frameBytes = 80 * 1024
} = {}): Promise<Buffer> {
  const events: Record<string, unknown>[] = [
    {
      type: 'context-options',
      wallTime: WALL_TIME,
      monotonicTime: 0,
      browserName: 'chromium',
      options: { viewport: { width: 1280, height: 720 } }
    }
  ]
  const resources: TraceZipResource[] = []
  for (let i = 0; i < frames; i++) {
    const sha1 = `frame${String(i).padStart(4, '0')}`
    resources.push({
      resourceName: `${sha1}.jpeg`,
      data: jpegFrame(frameBytes)
    })
    events.push({ type: 'screencast-frame', sha1, timestamp: i * 100 })
    if (i % 10 === 0) {
      const callId = `call@${i}`
      events.push(
        {
          type: 'before',
          callId,
          startTime: i * 100,
          class: 'Element',
          method: 'click',
          params: { selector: `#b${i}` }
        },
        { type: 'after', callId, endTime: i * 100 + 50 }
      )
    }
  }
  return buildTraceZip({
    traceNdjson: events.map((event) => JSON.stringify(event)).join('\n'),
    networkNdjson: Buffer.alloc(0),
    resources
  })
}
