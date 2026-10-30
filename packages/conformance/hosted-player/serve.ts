import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { preview } from 'vite'

import { HOSTED_PREVIEW_HOST } from './constants.js'

const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app'
)
const HOSTED_OUT_DIR = 'dist-hosted'

export interface HostedPreview {
  url: string
  close: () => Promise<void>
}

/** Serves the hosted build as `pnpm player:hosted` does: the app's own Vite config, so the `vercel.json` headers too. */
export async function serveHostedBuild(port: number): Promise<HostedPreview> {
  if (!fs.existsSync(path.join(APP_DIR, HOSTED_OUT_DIR, 'index.html'))) {
    throw new Error(
      `No hosted build in packages/app/${HOSTED_OUT_DIR}; run \`pnpm --filter @wdio/devtools-app build:hosted\` first`
    )
  }
  const server = await preview({
    root: APP_DIR,
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
    close: () => server.close()
  }
}
