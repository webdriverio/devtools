import { readFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

interface HostingConfig {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

const EVERY_PATH = '/(.*)'

const VERCEL_JSON = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../../vercel.json'
)

/** The headers trace.webdriver.io sends on every path, as `vercel.json` declares them. */
export function hostingHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as HostingConfig
  return Object.fromEntries(
    config.headers
      .filter(({ source }) => source === EVERY_PATH)
      .flatMap(({ headers }) => headers.map(({ key, value }) => [key, value]))
  )
}
