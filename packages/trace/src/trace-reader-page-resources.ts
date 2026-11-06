// A zip's stored stylesheets and fonts back as `PageResource`s; a zip without the index (older ones, foreign ones) has none.

import { strFromU8 } from 'fflate'
import {
  TRACE_ZIP_ENTRIES,
  type PageResource,
  type PageResourceKind,
  type TraceLog
} from '@wdio/devtools-shared'

import { bytesToBase64 } from './base64.js'
import type { TraceZipEntries } from './trace-reader-types.js'
import { parseNdjson } from './trace-reader-utils.js'

const KINDS: ReadonlySet<string> = new Set<PageResourceKind>([
  'stylesheet',
  'font'
])

/** The trace's `pageResources`, omitted for a zip that stored none. */
export function pageResourcesOf(
  files: TraceZipEntries
): Pick<TraceLog, 'pageResources'> {
  const resources = parsePageResources(files)
  return resources.length > 0 ? { pageResources: resources } : {}
}

function parsePageResources(files: TraceZipEntries): PageResource[] {
  const index = files[TRACE_ZIP_ENTRIES.pageResources]
  if (!index) {
    return []
  }
  const resources: PageResource[] = []
  for (const entry of parseNdjson(strFromU8(index))) {
    const { url, sha1, mimeType, kind } = entry
    if (
      typeof url !== 'string' ||
      typeof sha1 !== 'string' ||
      typeof mimeType !== 'string' ||
      typeof kind !== 'string' ||
      !KINDS.has(kind)
    ) {
      continue
    }
    const data = files[`${TRACE_ZIP_ENTRIES.resourcesDir}/${sha1}`]
    if (!data) {
      continue
    }
    resources.push({
      url,
      mimeType,
      kind: kind as PageResourceKind,
      data: bytesToBase64(data),
      size: data.byteLength
    })
  }
  return resources
}
