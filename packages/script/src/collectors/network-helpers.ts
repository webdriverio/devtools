/** Internal URLs, non-HTTP schemes and browser housekeeping requests, which
 *  neither the patched calls nor the Resource Timing entries report. */
export function shouldIgnoreRequest(url: string): boolean {
  if (!url) {
    return true
  }

  const urlLower = url.toLowerCase()

  if (urlLower.startsWith('data:')) {
    return true
  }
  if (urlLower.startsWith('blob:')) {
    return true
  }
  if (urlLower.startsWith('chrome:')) {
    return true
  }
  if (urlLower.startsWith('chrome-extension:')) {
    return true
  }
  if (urlLower.startsWith('about:')) {
    return true
  }

  if (urlLower.startsWith('ws:') || urlLower.startsWith('wss:')) {
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
