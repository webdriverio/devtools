#!/usr/bin/env node
// CLI entry for `show-trace` (also exposed as the root `pnpm show-trace`
// script): reconstructs a trace.zip, boots the backend in trace-serve mode, and
// opens the player in the default browser.

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { readTraceZip } from './trace-reader.js'
import { start } from './index.js'

const USAGE = `Usage: show-trace <trace.zip>

Opens a recorded trace.zip in the WebdriverIO Devtools player.`

function openBrowser(url: string): void {
  const platform = process.platform
  const command =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Best-effort — the URL is already printed for manual opening.
  }
}

export async function showTrace(zipArg: string): Promise<void> {
  const zipPath = path.resolve(process.cwd(), zipArg)
  const trace = await readTraceZip(zipPath)
  const { port } = await start({ trace })
  const url = `http://localhost:${port}`
  console.log(`\n  Trace player running at ${url}\n`)
  openBrowser(url)
}

/**
 * Full CLI entry — parse args, print help, run the player, handle errors. Shared
 * by the backend's own `show-trace` bin and the thin bins each adapter ships
 * (so `pnpm show-trace <zip>` works in a consumer project that installs the
 * adapter, where backend is only a transitive dependency).
 */
export async function runShowTraceCli(args: string[]): Promise<void> {
  const arg = args[0]
  if (!arg || arg === '-h' || arg === '--help') {
    console.log(USAGE)
    process.exit(arg ? 0 : 1)
  }
  try {
    await showTrace(arg)
  } catch (error) {
    console.error(`Failed to open trace: ${(error as Error).message}`)
    process.exit(1)
  }
}

// Auto-run only when executed as the CLI entry — including via a
// node_modules/.bin symlink (argv[1] is the symlink, so compare realpaths) —
// but not when imported by an adapter's bin.
function invokedAsCli(): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedAsCli()) {
  void runShowTraceCli(process.argv.slice(2))
}
