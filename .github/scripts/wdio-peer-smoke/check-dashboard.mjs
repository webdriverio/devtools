import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'

const STARTUP_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 250
const SCRIPT_DIR = 'node_modules/@wdio/devtools-script'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForPage(url, backend) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) {
      throw new Error(`the backend exited with code ${backend.exitCode}`)
    }
    try {
      return await fetch(url)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }
  throw new Error(
    `the backend did not answer ${url} within ${STARTUP_TIMEOUT_MS} ms`
  )
}

async function checkDashboard() {
  const port = await freePort()
  const backend = spawn(process.execPath, [
    'node_modules/@wdio/devtools-backend/dist/server.js',
    '--port',
    String(port)
  ])
  let log = ''
  backend.stdout.on('data', (chunk) => (log += chunk))
  backend.stderr.on('data', (chunk) => (log += chunk))
  try {
    const base = `http://127.0.0.1:${port}`
    const page = await waitForPage(`${base}/`, backend)
    assert.equal(page.status, 200, `GET / answered ${page.status}`)
    const html = await page.text()
    assert.match(html, /<title>/, 'GET / has no <title>')
    const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    assert.ok(bundle, 'the dashboard page names no /assets/*.js bundle')
    const asset = await fetch(`${base}${bundle}`)
    assert.equal(asset.status, 200, `GET ${bundle} answered ${asset.status}`)
  } catch (err) {
    console.error(`backend log:\n${log}`)
    throw err
  } finally {
    backend.kill()
  }
}

function checkScriptPackage() {
  for (const file of ['dist/script.js', 'types.d.ts']) {
    assert.ok(
      existsSync(path.join(SCRIPT_DIR, file)),
      `@wdio/devtools-script ships no ${file}`
    )
  }
  // skipLibCheck hides a missing file behind `any`, so the type-check step cannot see one.
  const types = readFileSync(path.join(SCRIPT_DIR, 'types.d.ts'), 'utf8')
  for (const [, spec] of types.matchAll(/from '(\.[^']+)'/g)) {
    assert.ok(
      existsSync(path.join(SCRIPT_DIR, spec)),
      `types.d.ts imports ${spec}, which is not in the package`
    )
  }
}

const failures = []
for (const check of [checkScriptPackage, checkDashboard]) {
  try {
    await check()
  } catch (err) {
    failures.push(err)
  }
}
if (failures.length > 0) {
  for (const err of failures) {
    console.error(`FAIL: ${err.message}`)
  }
  process.exit(1)
}
console.log(
  'packed backend serves the dashboard; @wdio/devtools-script ships its entry and types'
)
