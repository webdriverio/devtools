import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * Resolve the nightwatch CLI entry point. Honors `DEVTOOLS_NIGHTWATCH_BIN`
 * for testing/override; otherwise walks up from `baseDir` looking for
 * `node_modules/nightwatch/package.json` and resolves its `bin` to the
 * actual JS entry (avoids running the shell-script wrapper at
 * `node_modules/.bin/nightwatch` via node).
 */
export function resolveNightwatchBin(baseDir: string): string {
  const envOverride = process.env.DEVTOOLS_NIGHTWATCH_BIN
  if (envOverride) {
    const resolved = path.isAbsolute(envOverride)
      ? envOverride
      : path.resolve(process.cwd(), envOverride)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  let dir = baseDir
  const root = path.parse(dir).root
  while (dir !== root) {
    const nightwatchPkgPath = path.join(
      dir,
      'node_modules',
      'nightwatch',
      'package.json'
    )
    if (fs.existsSync(nightwatchPkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(nightwatchPkgPath, 'utf8'))
        const nightwatchDir = path.join(dir, 'node_modules', 'nightwatch')
        const binEntry =
          typeof pkg.bin === 'string'
            ? pkg.bin
            : (pkg.bin?.nightwatch ?? pkg.bin?.nw)
        if (binEntry) {
          const jsPath = path.resolve(nightwatchDir, binEntry)
          if (fs.existsSync(jsPath)) {
            return jsPath
          }
        }
      } catch {
        // malformed package.json — continue walking
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }

  throw new Error(
    'Cannot find nightwatch binary. Install nightwatch locally or set DEVTOOLS_NIGHTWATCH_BIN env var.'
  )
}

/**
 * Resolve the wdio CLI entry. Honors `DEVTOOLS_WDIO_BIN`; otherwise derives
 * from the `@wdio/cli` package's location (the published `bin/wdio.js`).
 */
export function resolveWdioBin(): string {
  const envOverride = process.env.DEVTOOLS_WDIO_BIN
  if (envOverride) {
    const overriddenPath = path.isAbsolute(envOverride)
      ? envOverride
      : path.resolve(process.cwd(), envOverride)
    if (!fs.existsSync(overriddenPath)) {
      throw new Error(
        `DEVTOOLS_WDIO_BIN "${overriddenPath}" does not exist or is not accessible`
      )
    }
    return overriddenPath
  }

  try {
    const cliEntry = require.resolve('@wdio/cli')
    const candidate = path.resolve(path.dirname(cliEntry), '../bin/wdio.js')
    if (!fs.existsSync(candidate)) {
      throw new Error(`Derived WDIO bin "${candidate}" does not exist`)
    }
    return candidate
  } catch (error) {
    throw new Error(
      `Failed to resolve WDIO binary. Provide DEVTOOLS_WDIO_BIN env var. ${(error as Error).message}`
    )
  }
}
