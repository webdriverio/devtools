import * as net from 'node:net'

/**
 * Return true if the given TCP port on `hostname` cannot be bound for
 * listening (already in use, or otherwise unavailable).
 */
export function isPortInUse(port: number, hostname: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, hostname)
  })
}

/**
 * Walk upward from `startPort` until a free port is found and return it.
 * Silent: callers that want to log retries should wrap this themselves.
 */
export async function findFreePort(
  startPort: number,
  hostname: string
): Promise<number> {
  let port = startPort
  while (await isPortInUse(port, hostname)) {
    port++
  }
  return port
}

/**
 * Classify an HTTP request into the categories the dashboard's Network tab
 * uses, preferring the response `mimeType` and falling back to URL extension
 * heuristics. Unknown shapes return `'xhr'`.
 */
export function getRequestType(url: string, mimeType?: string): string {
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
