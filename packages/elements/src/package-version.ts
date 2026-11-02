import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
        if (pkg.name === name) {
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
