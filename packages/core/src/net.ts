import * as net from 'node:net'

/** Kept exported here so importers predating the split keep resolving; the
 *  implementation is the browser-safe leaf `request-type.ts`. */
export { getRequestType } from './request-type.js'

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
