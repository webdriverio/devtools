import type { RequestType } from '@wdio/devtools-shared'

/**
 * Classify an HTTP request into a {@link RequestType}, preferring the response
 * `mimeType` and falling back to URL extension heuristics. The categories are
 * enumerated once, in shared's `REQUEST_TYPES`, so this text can't drift from
 * them. A shape it can't place returns `'xhr'` — never the vocabulary's
 * `'other'`, which is reserved for producers that classify nothing at all.
 *
 * A pure leaf module: the capture side's only classifier, importable from any
 * runtime. `net.ts` re-exports it under the same name for existing consumers,
 * but that module pulls in `node:net` and so can't be bundled for the browser.
 */
export function getRequestType(url: string, mimeType?: string): RequestType {
  const contentType = mimeType?.toLowerCase() ?? ''
  const urlLower = url.toLowerCase()
  if (contentType.includes('text/html')) {
    return 'document'
  }
  if (contentType.includes('text/css')) {
    return 'stylesheet'
  }
  if (
    contentType.includes('javascript') ||
    contentType.includes('ecmascript')
  ) {
    return 'script'
  }
  if (contentType.includes('image/')) {
    return 'image'
  }
  if (contentType.includes('font/') || contentType.includes('woff')) {
    return 'font'
  }
  if (contentType.includes('application/json')) {
    return 'fetch'
  }
  if (urlLower.endsWith('.html') || urlLower.endsWith('.htm')) {
    return 'document'
  }
  if (urlLower.endsWith('.css')) {
    return 'stylesheet'
  }
  if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs')) {
    return 'script'
  }
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/.test(urlLower)) {
    return 'image'
  }
  if (/\.(woff|woff2|ttf|eot|otf)$/.test(urlLower)) {
    return 'font'
  }
  return 'xhr'
}
