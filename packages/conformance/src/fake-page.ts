import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest,
  type TraceMutation
} from '@wdio/devtools-shared'

import {
  DOCUMENT_MIME,
  LOAD_MS,
  PAGES,
  RENDERED_AFTER_MS,
  RESPONSE_BYTES
} from './constants.js'
import type { PageDocument } from './types.js'

export const anchorOf = (url: string, bornAt: number): TraceMutation => ({
  type: 'childList',
  url,
  timestamp: bornAt,
  addedNodes: [],
  removedNodes: []
})

/** Whether the page has rendered an element yet: one it renders late is absent until then, as a real page's is. */
export function rendered(doc: PageDocument, selector: string): boolean {
  return (
    selector in (PAGES[doc.path] ?? {}) &&
    Date.now() - doc.bornAt >= (RENDERED_AFTER_MS[selector] ?? 0)
  )
}

/** A load as `packages/script`'s Resource Timing collector reports it: no headers, no status, the method only where the parser issued it. */
export function resourceTimingRow(
  id: number,
  url: string,
  mime: string,
  doc: PageDocument
): NetworkRequest {
  const isDocument = mime === DOCUMENT_MIME
  return {
    id: `rt-${doc.bornAt}-${id}`,
    url,
    method: isDocument ? '' : 'GET',
    type: isDocument
      ? 'document'
      : mime === 'text/css'
        ? 'stylesheet'
        : 'script',
    timestamp: doc.bornAt,
    startTime: 0,
    endTime: LOAD_MS,
    time: LOAD_MS,
    size: RESPONSE_BYTES,
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  }
}
