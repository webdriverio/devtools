// Usage: tsx serve-fixtures.ts [--port N] [--host H]; prints the base URL for DEVTOOLS_EXAMPLE_BASE_URL.

import { parseArgs } from 'node:util'

import { FIXTURE_DEFAULT_HOST, FIXTURE_DEFAULT_PORT } from './constants.js'
import { startFixtureSite } from './fixture-site.js'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(FIXTURE_DEFAULT_PORT) },
    host: { type: 'string', default: FIXTURE_DEFAULT_HOST }
  }
})

const site = await startFixtureSite(Number(values.port), values.host)
console.log(`fixture site listening on ${site.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void site.close().then(() => process.exit(0))
  })
}
