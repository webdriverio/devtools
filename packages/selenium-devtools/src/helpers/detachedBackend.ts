import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export async function startDetachedBackend(opts: {
  port: number
  hostname: string
  readyTimeoutMs?: number
}): Promise<{ port: number }> {
  const backendPath = require.resolve('@wdio/devtools-backend')
  const code = `import(${JSON.stringify(backendPath)}).then(m => m.start({ port: ${opts.port}, hostname: ${JSON.stringify(opts.hostname)} })).catch(err => { console.error(err); process.exit(1) })`
  spawn(process.execPath, ['-e', code], {
    detached: true,
    stdio: 'ignore'
  }).unref()

  const deadline = Date.now() + (opts.readyTimeoutMs ?? 10000)
  while (Date.now() < deadline) {
    if (await canConnect(opts.port, opts.hostname)) {
      return { port: opts.port }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Detached backend never came up on ${opts.hostname}:${opts.port}`
  )
}

function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(port, host)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
  })
}
