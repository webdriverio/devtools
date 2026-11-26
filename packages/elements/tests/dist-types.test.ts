import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { describe, it, expect } from 'vitest'

const distDir = path.resolve(
  url.fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'dist'
)

const PRIVATE_IMPORT_RE =
  /(?:from|import\()\s*['"](?:@wdio\/devtools-(?:core|shared|trace)|[^'"]*\/packages\/(?:core|shared|trace)\/)/

function declarationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return declarationFiles(full)
    }
    return entry.name.endsWith('.d.ts') ? [full] : []
  })
}

const declarations = declarationFiles(distDir)

describe('elements dist type declarations', () => {
  // Private workspace packages are never published, so a type imported from one resolves to `any` for consumers.
  it.skipIf(declarations.length === 0)(
    'import no private workspace package',
    () => {
      const leaks = declarations.flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => PRIVATE_IMPORT_RE.test(line))
          .map((line) => `${path.relative(distDir, file)}: ${line.trim()}`)
      )
      expect(leaks).toEqual([])
    }
  )

  it.skipIf(declarations.length === 0)(
    'declare every type the package.json exports map names',
    () => {
      const missing = ['index.d.ts', 'locators/index.d.ts'].filter(
        (file) => !fs.existsSync(path.join(distDir, file))
      )
      expect(missing).toEqual([])
    }
  )
})
