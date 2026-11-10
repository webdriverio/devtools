import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function isModuleNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')
  )
}

export function packageVersionOf(
  resolvedFile: string,
  name: string
): string | undefined {
  try {
    let dir = dirname(resolvedFile)
    for (;;) {
      const manifest = join(dir, 'package.json')
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string
          version?: string
        }
        // A nameless manifest (`{"type":"module"}` in build/) sits inside the package; a named one is its root.
        if (pkg.name) {
          return pkg.name === name ? pkg.version : undefined
        }
      }
      const parent = dirname(dir)
      if (parent === dir) {
        return undefined
      }
      dir = parent
    }
  } catch (err) {
    console.warn(
      `@wdio/elements: could not read the version of ${name}: ${(err as Error).message}`
    )
    return undefined
  }
}
