import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'

const STARTUP_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 5_000
const SERVER = 'node_modules/@wdio/devtools-backend/dist/server.js'
const SCRIPT_DIR = 'node_modules/@wdio/devtools-script'
const LISTENING_LINE = /devtools-backend listening at (http:\/\/\S+)/

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

// The backend moves off a taken --port, so the port it prints is the one it bound.
function waitForListening(backend, output) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `the backend printed no listening line within ${STARTUP_TIMEOUT_MS} ms`
          )
        ),
      STARTUP_TIMEOUT_MS
    )
    backend.stdout.on('data', () => {
      const url = output.text.match(LISTENING_LINE)?.[1]
      if (url) {
        clearTimeout(timer)
        resolve(url)
      }
    })
    // 'close' comes after the output streams end, so the log is complete here.
    backend.on('close', (code, signal) => {
      clearTimeout(timer)
      const how = signal ? `signal ${signal}` : `exit code ${code}`
      reject(new Error(`the backend stopped before it listened (${how})`))
    })
  })
}

async function get(url) {
  try {
    // Its own limit, body included: a backend can accept and never answer.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return { status: res.status, body: await res.text() }
  } catch (err) {
    throw new Error(`GET ${url} failed`, { cause: err })
  }
}

async function checkDashboard() {
  const backend = spawn(process.execPath, [
    SERVER,
    '--port',
    String(await freePort())
  ])
  const output = { text: '' }
  backend.stdout.on('data', (chunk) => (output.text += chunk))
  backend.stderr.on('data', (chunk) => (output.text += chunk))
  try {
    const base = new URL(await waitForListening(backend, output)).origin
    const page = await get(`${base}/`)
    assert.equal(page.status, 200, `GET / answered ${page.status}`)
    assert.match(page.body, /<title>/, 'GET / has no <title>')
    const bundle = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    assert.ok(bundle, 'the dashboard page names no /assets/*.js bundle')
    const asset = await get(`${base}${bundle}`)
    assert.equal(asset.status, 200, `GET ${bundle} answered ${asset.status}`)
  } catch (err) {
    console.error(`backend log:\n${output.text}`)
    throw err
  } finally {
    // SIGTERM can be handled and ignored; the job would then wait on the child.
    backend.kill('SIGKILL')
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

function describe(err) {
  let text = err.message
  for (let cause = err.cause; cause; cause = cause.cause) {
    text += ` <- ${cause.message}${cause.code ? ` (${cause.code})` : ''}`
  }
  return text
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
    console.error(`FAIL: ${describe(err)}`)
  }
  process.exit(1)
}
console.log(
  'packed backend serves the dashboard; @wdio/devtools-script ships its entry and the files its types import by relative path'
)
