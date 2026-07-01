// Proof harness: plays the role the dashboard plays — subscribes to the
// backend's /client WebSocket and records every frame the backend broadcasts.
// If the Python spike's frames arrive here, the language-agnostic boundary is
// proven end to end without needing to eyeball a browser.
//
// Run (from repo root, after starting the backend):
//   node examples/python-spike/verify-client.mjs
// It listens for COLLECT_MS, prints the scopes it saw, and exits non-zero if
// the expected set didn't arrive.

import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

// `ws` is a dependency of packages/backend, not hoisted to the repo root —
// anchor module resolution there so this runs from any cwd.
const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(
  pathToFileURL(resolve(here, '../../packages/backend/package.json'))
)
const WebSocket = require('ws')

const HOST = process.env.DEVTOOLS_HOST || 'localhost'
const PORT = process.env.DEVTOOLS_PORT || '3000'
const COLLECT_MS = Number(process.env.COLLECT_MS || 6000)
const EXPECTED = (
  process.env.EXPECT || 'metadata,suites,commands,consoleLogs,networkRequests'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const seen = new Map()
const ws = new WebSocket(`ws://${HOST}:${PORT}/client`)

ws.on('open', () => console.log(`[client] subscribed to ws://${HOST}:${PORT}/client`))
ws.on('error', (e) => { console.error('[client] error:', e.message); process.exit(2) })
ws.on('message', (buf) => {
  let msg
  try { msg = JSON.parse(buf.toString()) } catch { return }
  if (!msg || !msg.scope) return
  seen.set(msg.scope, (seen.get(msg.scope) || 0) + 1)
  const preview = JSON.stringify(msg.data).slice(0, 70)
  console.log(`[client] ◀ ${msg.scope.padEnd(16)} ${preview}…`)
})

setTimeout(() => {
  console.log('\n[client] ── summary ──')
  for (const [scope, n] of seen) console.log(`  ${scope.padEnd(18)} ×${n}`)
  const missing = EXPECTED.filter((s) => !seen.has(s))
  if (missing.length) {
    console.log(`\n  ✗ missing expected scopes: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log('\n  ✓ all expected scopes received — boundary proven')
  process.exit(0)
}, COLLECT_MS)
