import { isBrowserInternalUrl, schemeOf } from '@wdio/devtools-shared'

/** Inline documents and sockets: no request a server answers either. */
const INLINE_OR_SOCKET_SCHEMES = new Set(['data', 'blob', 'ws', 'wss'])

function hasInternalScheme(url: string): boolean {
  const scheme = schemeOf(url)
  return (
    scheme !== undefined &&
    (INLINE_OR_SOCKET_SCHEMES.has(scheme) || isBrowserInternalUrl(url))
  )
}

/** Internal URLs, non-HTTP schemes and browser housekeeping requests, which
 *  neither the patched calls nor the Resource Timing entries report. */
export function shouldIgnoreRequest(url: string): boolean {
  if (!url) {
    return true
  }

  const urlLower = url.toLowerCase()

  if (hasInternalScheme(url)) {
    return true
  }

  if (urlLower.includes('/.well-known/')) {
    return true
  }
  if (urlLower.includes('/favicon.ico')) {
    return true
  }

  return false
}

/** The form Resource Timing reports a URL in: absolute, resolved against the
 *  document, and without the fragment. A patched call may have been made with
 *  a relative one, or one carrying a `#`. */
export function resourceTimingUrl(url: string): string {
  try {
    const resolved = new URL(url, document.baseURI)
    resolved.hash = ''
    return resolved.href
  } catch {
    return url
  }
}
