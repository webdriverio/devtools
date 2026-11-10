// A zip's stored stylesheets and fonts as entries for the player to read; a zip without the index (older ones, foreign ones) has none.

import { strFromU8 } from 'fflate'
import {
  TRACE_ZIP_ENTRIES,
  type PageResourceKind,
  type PageResourceRef
} from '@wdio/devtools-shared'

import type { TraceEntries } from './trace-reader-types.js'
import { parseNdjson } from './trace-reader-utils.js'

const KINDS: ReadonlySet<string> = new Set<PageResourceKind>([
  'stylesheet',
  'font'
])

/** The stored page resources whose bytes the zip holds. */
export function pageResourcesOf({
  names,
  entries
}: TraceEntries): PageResourceRef[] {
  const index = entries[TRACE_ZIP_ENTRIES.pageResources]
  if (!index) {
    return []
  }
  const resources: PageResourceRef[] = []
  for (const line of parseNdjson(strFromU8(index))) {
    const { url, sha1, mimeType, kind, size } = line
    if (
      typeof url !== 'string' ||
      typeof sha1 !== 'string' ||
      typeof mimeType !== 'string' ||
      typeof kind !== 'string' ||
      !KINDS.has(kind)
    ) {
      continue
    }
    const entry = `${TRACE_ZIP_ENTRIES.resourcesDir}/${sha1}`
    if (!names.has(entry)) {
      continue
    }
    resources.push({
      url,
      mimeType,
      kind: kind as PageResourceKind,
      entry,
      size: typeof size === 'number' ? size : 0
    })
  }
  return resources
}
