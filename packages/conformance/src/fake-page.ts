import vm from 'node:vm'

import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest,
  type TraceMutation
} from '@wdio/devtools-shared'

import {
  DOCUMENT_MIME,
  LOAD_MS,
  PAGE_TITLES,
  PAGES,
  RENDERED_AFTER_MS,
  RESPONSE_BYTES,
  SUBRESOURCES
} from './constants.js'
import type { PageDocument, ScriptForm } from './types.js'

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

/** The globals a page script reads its own timings, title and url from, as a loaded Chrome document answers them. */
function pageGlobals(doc: PageDocument): Record<string, unknown> {
  const { origin } = new URL(doc.url)
  const navigation = {
    name: doc.url,
    fetchStart: 0,
    domainLookupStart: 0,
    domainLookupEnd: 0,
    connectStart: 0,
    connectEnd: 0,
    requestStart: 1,
    responseStart: LOAD_MS - 1,
    responseEnd: LOAD_MS,
    domContentLoadedEventEnd: LOAD_MS,
    loadEventEnd: LOAD_MS
  }
  const resources = Object.entries(SUBRESOURCES).map(([path, mime]) => ({
    name: `${origin}${path}`,
    initiatorType: mime === 'text/css' ? 'link' : 'script',
    startTime: 0,
    duration: LOAD_MS,
    responseEnd: LOAD_MS,
    transferSize: RESPONSE_BYTES
  }))
  const entries: Record<string, unknown[]> = {
    navigation: [navigation],
    resource: resources
  }
  return {
    performance: { getEntriesByType: (type: string) => entries[type] ?? [] },
    location: { href: doc.url },
    document: {
      title: PAGE_TITLES[doc.path] ?? '',
      cookie: '',
      readyState: 'complete',
      referrer: '',
      characterSet: 'UTF-8'
    },
    navigator: { userAgent: 'conformance', language: 'en', platform: 'fake' }
  }
}

/**
 * Runs a script against the page's globals the way the browser would, so what it answers depends on what it returns:
 * `body` is a WebDriver script body, `declaration` a BiDi function declaration, `expression` a BiDi expression.
 */
export function runInPage(
  doc: PageDocument,
  source: string,
  form: ScriptForm
): unknown {
  const context = vm.createContext(pageGlobals(doc))
  context.window = context
  const call =
    form === 'body'
      ? `(function () {${source}\n})()`
      : form === 'declaration'
        ? `(${source})()`
        : source
  return vm.runInContext(call, context, { timeout: 1000 })
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
