#!/usr/bin/env node
// CLI entry for the live dashboard server. `index.ts` is the LIBRARY entry the
// JS adapters import in-process; a "start if run directly" guard cannot live
// there, because `show-trace.ts` imports `start` from it, which makes index a
// shared module whose body tsup hoists into `dist/chunk-*.js` — there
// `import.meta.url` is the chunk's path and never equals `process.argv[1]`, so
// the guard silently never fires. A leaf entry keeps its body in its own output
// file, which is why this file needs no guard at all.

import { start } from './index.js'
import { parseServerArgs, SERVER_USAGE } from './server-args.js'

async function run(args: string[]): Promise<void> {
  const { help, ...opts } = parseServerArgs(args)
  if (help) {
    console.log(SERVER_USAGE)
    return
  }
  try {
    const { port } = await start(opts)
    // Our own line, so a consumer scraping stdout for the bound port (the Python
    // adapter does) depends on this file rather than on Fastify's logger staying
    // enabled. The port is the one actually bound, which differs from any
    // `--port` when that was taken.
    const host = opts.hostname ?? 'localhost'
    console.log(`devtools-backend listening at http://${host}:${port}`)
  } catch (error) {
    console.error(
      `Failed to start WebdriverIO Devtools: ${(error as Error).message}`
    )
    process.exit(1)
  }
}

void run(process.argv.slice(2))
