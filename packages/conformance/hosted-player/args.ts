import { parseArgs } from 'node:util'

import { HOSTED_PREVIEW_PORT } from './constants.js'

export interface CheckArgs {
  /** A deployed player to check; absent, the local hosted build is served and checked. */
  url?: string
  port: number
  headed: boolean
}

/** Reads `[--url <https://…>] [--port N] [--headed]`; throws on anything else. */
export function parseCheckArgs(argv: readonly string[]): CheckArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      url: { type: 'string' },
      port: { type: 'string', default: String(HOSTED_PREVIEW_PORT) },
      headed: { type: 'boolean', default: false }
    },
    strict: true,
    allowPositionals: false
  })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be a TCP port, got "${values.port}"`)
  }
  return {
    ...(values.url === undefined ? {} : { url: baseUrl(values.url) }),
    port,
    headed: values.headed
  }
}

/** The page to open, without a trailing slash, so paths join the same way for a local and a deployed player. */
function baseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`--url must be an absolute URL, got "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`--url must be http or https, got "${raw}"`)
  }
  if (url.search || url.hash) {
    throw new Error(`--url must name the page alone, got "${raw}"`)
  }
  return url.href.replace(/\/+$/, '')
}
