import type { RequestType } from './types.js'

/**
 * Classify an HTTP request into a {@link RequestType}, preferring the response
 * `mimeType` and falling back to URL extension heuristics. The categories are
 * enumerated once, in `REQUEST_TYPES`, so this text can't drift from them. A
 * shape it can't place returns `'xhr'`, never the vocabulary's `'other'`,
 * which is reserved for producers that classify nothing at all.
 *
 * A pure leaf module, importable from any runtime: core's driver-side capture
 * and the page collector's Resource Timing capture are both classified here,
 * so a content-type or extension is read by one table rather than two.
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
