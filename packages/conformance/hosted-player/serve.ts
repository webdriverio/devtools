import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { preview, type Plugin } from 'vite'

import { HOSTED_PREVIEW_HOST, SERVED_ZIP_PREFIX } from './constants.js'

const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app'
)
const HOSTED_OUT_DIR = 'dist-hosted'

export interface HostedPreview {
  url: string
  close: () => Promise<void>
  /** Serves a zip from the player's own origin and returns its path, for a `?trace=` open. */
  serveZip: (zipPath: string) => string
}

// Only paths handed out by `serveZip` are answered, so the route reads no file it was not given.
function zipRoutes(zips: Map<string, string>): Plugin {
  return {
    name: 'hosted-player-check-zips',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const zipPath = zips.get((request.url ?? '').split('?')[0])
        if (!zipPath) {
          return next()
        }
        response.setHeader('Content-Type', 'application/zip')
        fs.createReadStream(zipPath).pipe(response)
      })
    }
  }
}

/** Serves the hosted build as `pnpm player:hosted` does: the app's own Vite config, so the `vercel.json` headers too. */
export async function serveHostedBuild(port: number): Promise<HostedPreview> {
  if (!fs.existsSync(path.join(APP_DIR, HOSTED_OUT_DIR, 'index.html'))) {
    throw new Error(
      `No hosted build in packages/app/${HOSTED_OUT_DIR}; run \`pnpm --filter @wdio/devtools-app build:hosted\` first`
    )
  }
  const zips = new Map<string, string>()
  const server = await preview({
    root: APP_DIR,
    plugins: [zipRoutes(zips)],
    mode: 'hosted',
    logLevel: 'warn',
    build: { outDir: HOSTED_OUT_DIR },
    preview: {
      host: HOSTED_PREVIEW_HOST,
      port,
      strictPort: true,
      open: false
    }
  })
  return {
    url: `http://${HOSTED_PREVIEW_HOST}:${port}`,
    close: () => server.close(),
    serveZip: (zipPath) => {
      const route = `${SERVED_ZIP_PREFIX}${zips.size}.zip`
      zips.set(route, zipPath)
      return route
    }
  }
}
