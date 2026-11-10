// The URLs a smoke zip stores the bytes of, and the check that each expected resource is among them.

import { strFromU8, unzipSync } from 'fflate'

import { TRACE_ZIP_ENTRIES } from '@wdio/devtools-shared'

import type { TraceZip } from './types.js'

/** The URLs a zip stores the bytes of; an index line whose bytes are missing does not count. */
export function readStoredResourceUrls(zip: Uint8Array): string[] {
  const files = unzipSync(zip, {
    filter: (file) =>
      file.name === TRACE_ZIP_ENTRIES.pageResources ||
      file.name.startsWith(`${TRACE_ZIP_ENTRIES.resourcesDir}/`)
  })
  const index = files[TRACE_ZIP_ENTRIES.pageResources]
  if (!index) {
    return []
  }
  return strFromU8(index)
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      // Untrusted JSON; only `url` and `sha1` are read.
      const entry = JSON.parse(line) as { url?: unknown; sha1?: unknown }
      return typeof entry.url === 'string' &&
        typeof entry.sha1 === 'string' &&
        files[`${TRACE_ZIP_ENTRIES.resourcesDir}/${entry.sha1}`]
        ? [entry.url]
        : []
    })
}

/** Every zip stores a resource whose path ends in each expected suffix. */
export function checkPageResources(
  expected: readonly string[] | undefined,
  zips: readonly TraceZip[]
): string[] {
  if (!expected?.length) {
    return []
  }
  return zips.flatMap((zip) => {
    const stored = zip.storedResources ?? []
    return expected
      .filter(
        (suffix) =>
          !stored.some((url) => {
            try {
              return new URL(url).pathname.endsWith(suffix)
            } catch {
              return false
            }
          })
      )
      .map(
        (suffix) =>
          `${zip.path} stores no ${suffix}; stored: ${stored.join(', ') || '(none)'}`
      )
  })
}
