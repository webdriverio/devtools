import { readFileSync } from 'node:fs'
import path from 'node:path'
import url from 'node:url'

interface HostingConfig {
  headers: { headers: { key: string; value: string }[] }[]
}

const VERCEL_JSON = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '../../vercel.json'
)

/** The response headers trace.webdriver.io sends, as `vercel.json` declares them. */
export function hostingHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as HostingConfig
  return Object.fromEntries(
    config.headers.flatMap(({ headers }) =>
      headers.map(({ key, value }) => [key, value])
    )
  )
}
