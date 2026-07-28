// Records the live-mode WS event stream into golden fixtures for live-parity.
// This is the live-mode counterpart of regen.ts — the one browser-dependent
// step for Phase 1b. Run deliberately:
//
//   pnpm fixtures:record-live            # all ready entries
//   pnpm fixtures:record-live wdio-mocha # one entry by id
//
// Mechanism: live mode is normally interactive (boots a backend, opens the
// DevTools window, waits for close). Reuse mode is not — when the REUSE_ENV vars
// point at an already-running backend, the adapter skips startup + the window
// and just connects its worker WebSocket. So we stand in AS that backend: start
// a WS server on the worker path, launch the example in live+reuse mode aimed at
// it, capture every SocketMessage the adapter streams, and write them to
// test/fixtures/<id>/live-events.json.
//
// The run's completion signal is the worker WS CLOSING, not the child process
// exiting: live-mode runners keep webdriver/keep-alive handles open and often
// don't terminate on their own. The adapter flushes and closes its socket at
// run-end ("Rerun complete — flushing WebSocket"), so that close = "done
// streaming". We then force-kill the (possibly hung) child.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { WebSocketServer } from 'ws'

import { WS_PATHS } from '../../packages/shared/src/routes.js'
import { REUSE_ENV } from '../../packages/shared/src/runner.js'
import type { SocketMessage } from '../../packages/shared/src/ws.js'
import { projectForFixture } from '../capture/live-summarize.js'
import { READY_ENTRIES, type VerificationEntry } from '../capture/matrix.js'
import { fixtureLiveEvents, REPO_ROOT } from './paths.js'

const HOST = '127.0.0.1'
const FLUSH_GRACE_MS = 700
const MAX_RUN_MS = 180_000
// Per-scenario runners (e.g. nightwatch cucumber) close and re-open the worker
// WS mid-run on session changes. Treat the run as ended only after every
// connection has stayed closed this long — a single close isn't run-end.
const RECONNECT_GRACE_MS = 1500

interface Recorder {
  port: number
  messages: unknown[]
  /** Resolves once all worker WS connections have stayed closed (run-end). */
  streamEnded: Promise<void>
  close(): Promise<void>
}

// Force half-open sockets shut so wss.close's callback actually fires — a
// persistent re-runner (nightwatch reuse mode) can leave one dangling.
function closeServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate()
    }
    wss.close(() => resolve())
  })
}

// Stand-in worker-WS backend: the adapter, launched in reuse mode, connects
// here and streams its SocketMessages instead of to a real backend.
async function startRecorder(): Promise<Recorder> {
  const messages: unknown[] = []
  let active = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let resolveEnded: () => void = () => {}
  const streamEnded = new Promise<void>((resolve) => {
    resolveEnded = resolve
  })
  const wss = new WebSocketServer({
    host: HOST,
    port: 0,
    path: WS_PATHS.worker
  })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  wss.on('connection', (socket) => {
    active += 1
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    console.log('  ↳ adapter connected — streaming…')
    socket.on('message', (raw: { toString(): string }) => {
      try {
        messages.push(JSON.parse(raw.toString()))
      } catch {
        // Non-JSON frames (pings etc.) — ignore.
      }
    })
    socket.on('close', () => {
      active -= 1
      if (active === 0) {
        idleTimer = setTimeout(() => {
          if (active === 0) {
            resolveEnded()
          }
        }, RECONNECT_GRACE_MS)
        idleTimer.unref()
      }
    })
  })
  return {
    port: (wss.address() as { port: number }).port,
    messages,
    streamEnded,
    close: () => closeServer(wss)
  }
}

// Kill the child's whole process tree. entry.command is often `pnpm --filter …`,
// which does NOT forward signals to the runner it spawns — so signalling the
// direct child leaves nightwatch/chromedriver alive and the run hangs. On POSIX
// the child leads its own process group (detached), so a negative pid signals
// the group; Windows has no groups, so kill the tree with taskkill.
function killTree(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'])
    } else {
      process.kill(-pid, signal)
    }
  } catch {
    // Group already gone — nothing to signal.
  }
}

// If the recorder itself is interrupted, take the detached child group with it
// (a detached child does not receive the terminal's Ctrl-C).
let activeChildPid: number | undefined
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (activeChildPid !== undefined) {
      killTree(activeChildPid, 'SIGKILL')
    }
    process.exit(130)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Like delay, but the timer is unref'd so a losing race branch can't keep the
// Node event loop alive after the run finishes (else the process hangs until
// the MAX_RUN timer elapses).
function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
  })
}

async function recordEntry(entry: VerificationEntry): Promise<boolean> {
  console.log(`\n── ${entry.label} [${entry.id}] ──`)
  const { port, messages, streamEnded, close } = await startRecorder()

  const { cmd, args } = entry.command
  console.log(
    `  $ DEVTOOLS_MODE=live (reuse @ ${HOST}:${port}) ${cmd} ${args.join(' ')}`
  )
  const run = spawn(cmd, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      DEVTOOLS_MODE: 'live',
      [REUSE_ENV.REUSE]: '1',
      [REUSE_ENV.HOST]: HOST,
      [REUSE_ENV.PORT]: String(port)
    },
    // Own process group on POSIX so killTree can signal the whole tree; on
    // Windows shell:true runs the .cmd shim and taskkill /T handles the tree.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32'
  })
  activeChildPid = run.pid
  const exited = new Promise<void>((resolve) => run.on('exit', () => resolve()))

  // Done when the adapter closes its stream, the child exits, or we time out —
  // whichever comes first. Live-mode runners usually hang (reuse mode is a
  // persistent re-runner), so streamEnded wins and we terminate the tree.
  await Promise.race([streamEnded, exited, timeout(MAX_RUN_MS)])
  await delay(FLUSH_GRACE_MS)
  if (run.exitCode === null && !run.killed && run.pid !== undefined) {
    killTree(run.pid, 'SIGTERM')
    await Promise.race([exited, timeout(3000)])
    if (run.exitCode === null) {
      killTree(run.pid, 'SIGKILL')
    }
  }
  activeChildPid = undefined
  await close()

  if (messages.length === 0) {
    console.error(
      '  ✗ no live events captured — did the adapter connect in reuse mode?'
    )
    return false
  }
  const dest = fixtureLiveEvents(entry.id)
  mkdirSync(path.dirname(dest), { recursive: true })
  // Persist only the parity projection (scope + command names): the raw stream
  // is multi-MB of screencast/DOM/network payloads, far too large to commit.
  const lite = projectForFixture(messages as SocketMessage[])
  writeFileSync(dest, JSON.stringify(lite, null, 2))
  console.log(
    `  ✓ ${messages.length} live events → ${path.relative(REPO_ROOT, dest)}`
  )
  return true
}

const only = process.argv.slice(2)
const targets = only.length
  ? READY_ENTRIES.filter((e) => only.includes(e.id))
  : READY_ENTRIES

if (only.length && targets.length === 0) {
  console.error(`No ready entry matches: ${only.join(', ')}`)
  console.error(`Known: ${READY_ENTRIES.map((e) => e.id).join(', ')}`)
  process.exit(1)
}

const results: Array<{ id: string; ok: boolean }> = []
for (const entry of targets) {
  results.push({ id: entry.id, ok: await recordEntry(entry) })
}
const failed = results.filter((r) => !r.ok)
console.log(
  `\nRecorded ${results.length - failed.length}/${results.length} live fixtures.`
)
// Exit explicitly: a killed runner can leave a grandchild (e.g. chromedriver)
// holding the event loop open, which would otherwise hang the script.
process.exit(failed.length ? 1 : 0)
