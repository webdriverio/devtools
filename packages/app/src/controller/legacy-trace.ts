// A payload a backend reconstructed itself (older backends' `show-trace`, or `start({ trace })`), its images inline as base64, served to the player through an in-memory archive.

import {
  imageDimensions,
  isPageResource,
  type LegacyTracePlayerData,
  type PageResourceRef,
  type TracePlayerData
} from '@wdio/devtools-shared'

import type { OpenedTrace, TraceArchiveClient } from './trace-archive.js'

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const decodedLength = (base64: string): number =>
  Math.floor((base64.length * 3) / 4)

/** Names each inline image and stored resource by an in-memory entry, as a zip's would be. */
export function openLegacyTrace(payload: LegacyTracePlayerData): OpenedTrace {
  const bodies = new Map<string, string>()
  // Untrusted JSON: a payload with no frame list still plays its actions.
  const served = Array.isArray(payload.frames) ? payload.frames : []
  const frames = served.flatMap(({ timestamp, screenshot }, i) => {
    if (!screenshot) {
      return []
    }
    const entry = `legacy/frame-${i}`
    bodies.set(entry, screenshot)
    return [{ timestamp, entry }]
  })
  const pageResources = (payload.trace.pageResources ?? [])
    .filter(isPageResource)
    .map(({ url, kind, mimeType, data, size }, i): PageResourceRef => {
      const entry = `legacy/resource-${i}`
      bodies.set(entry, data)
      return { url, kind, mimeType, entry, size }
    })
  const images = served.flatMap(({ screenshot }) =>
    screenshot ? [screenshot] : []
  )
  const first = images[0]
  const frameSize = first ? imageDimensions(first) : null
  const archive: TraceArchiveClient = {
    open: () => Promise.reject(new Error('A served payload is already open')),
    read: (name) => {
      const body = bodies.get(name)
      return body === undefined
        ? Promise.reject(new Error(`The served trace has no entry ${name}`))
        : Promise.resolve(new Blob([decode(body)]))
    },
    close: () => bodies.clear()
  }
  const data: TracePlayerData = {
    ...payload,
    trace: { ...payload.trace, pageResources: undefined },
    frames,
    ...(frameSize ? { frameSize } : {}),
    ...(images.length
      ? { frameBytes: Math.max(...images.map(decodedLength)) }
      : {}),
    ...(pageResources.length ? { pageResources } : {})
  }
  return { data, archive }
}
