import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Load the `@wdio/devtools-script` browser preload, wrapped in an async IIFE
 * so its top-level `await` works inside a regular `<script>` element body.
 * Shared by selenium-devtools and nightwatch-devtools, which both inject the
 * script via `document.createElement('script')` rather than BiDi preload (the
 * WDIO service uses `browser.scriptAddPreloadScript`, which doesn't need the
 * wrap and stays in its own adapter).
 */
export async function loadInjectableScript(): Promise<string> {
  const scriptPath = require.resolve('@wdio/devtools-script')
  const scriptDir = path.dirname(scriptPath)
  const preloadScriptPath = path.join(scriptDir, 'script.js')
  const scriptContent = await fs.readFile(preloadScriptPath, 'utf-8')
  return `(async function() { ${scriptContent} })()`
}

/**
 * Poll a readiness check until it returns true, or the attempts run out.
 * Defaults to 5 × 200ms = up to 1 second total — chosen empirically to cover
 * the async IIFE init time across browsers we test against.
 */
export async function pollUntilReady(
  check: () => Promise<boolean>,
  opts: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const attempts = opts.attempts ?? 5
  const intervalMs = opts.intervalMs ?? 200
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    if (await check()) {
      return true
    }
  }
  return false
}
