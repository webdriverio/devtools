// Usage: tsx run.ts [--url <deployed player>] [--port N] [--headed]
// Without --url it serves packages/app/dist-hosted itself; `pnpm player:e2e` builds that first.

import { parseCheckArgs } from './args.js'
import { checkHostedPlayer } from './check.js'
import { serveHostedBuild, type HostedPreview } from './serve.js'

async function main(): Promise<number> {
  let preview: HostedPreview | undefined
  try {
    const args = parseCheckArgs(process.argv.slice(2))
    if (!args.url) {
      preview = await serveHostedBuild(args.port)
    }
    const baseUrl = args.url ?? preview?.url ?? ''
    console.log(`hosted-player: checking ${baseUrl}`)
    await checkHostedPlayer({ baseUrl, headed: args.headed })
    console.log('hosted-player: PASS')
    return 0
  } catch (error) {
    console.error(
      `hosted-player: FAIL ${error instanceof Error ? error.message : String(error)}`
    )
    return 1
  } finally {
    await preview?.close()
  }
}

// Exits explicitly: a driver or socket left open would otherwise keep a finished run alive.
process.exit(await main())
