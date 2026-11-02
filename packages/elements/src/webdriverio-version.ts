import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const WDIO_SNAPSHOT_MIN = { major: 10, minor: 2 } as const

const VERSION_RE = /^(\d+)\.(\d+)\./

export function rendersWithWdioSnapshot(version: string | undefined): boolean {
  const match = VERSION_RE.exec(version ?? '')
  if (!match) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return (
    major > WDIO_SNAPSHOT_MIN.major ||
    (major === WDIO_SNAPSHOT_MIN.major && minor >= WDIO_SNAPSHOT_MIN.minor)
  )
}

export function installedWebdriverioVersion(): string | undefined {
  try {
    let dir = dirname(createRequire(import.meta.url).resolve('webdriverio'))
    for (;;) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string
          version?: string
        }
        if (pkg.name === 'webdriverio') {
          return pkg.version
        }
      }
      const parent = dirname(dir)
      if (parent === dir) {
        return undefined
      }
      dir = parent
    }
  } catch {
    return undefined
  }
}

let usesSnapshot: boolean | undefined

export function usesWdioSnapshot(): boolean {
  usesSnapshot ??= rendersWithWdioSnapshot(installedWebdriverioVersion())
  return usesSnapshot
}
