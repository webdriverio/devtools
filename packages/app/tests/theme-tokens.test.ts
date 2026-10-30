import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(APP_ROOT, 'src')
const SCANNED_EXTENSIONS = new Set(['.ts', '.js', '.html', '.css'])

// Tailwind's own palette is all lowercase, so a camelCase colour name can only be one of ours.
const CUSTOM_COLOR_UTILITY =
  /(?<![\w-])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|caret|decoration|accent|shadow)-([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

function themeColorTokens(): Set<string> {
  const css = readFileSync(join(SRC, 'tailwind.css'), 'utf8')
  const theme = css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? ''
  return new Set([...theme.matchAll(/--color-([\w-]+)\s*:/g)].map((m) => m[1]))
}

function customColorUsages(): Map<string, string[]> {
  const usages = new Map<string, string[]>()
  const files = [...sourceFiles(SRC), join(APP_ROOT, 'index.html')]
  for (const file of files) {
    for (const [utility, name] of readFileSync(file, 'utf8').matchAll(
      CUSTOM_COLOR_UTILITY
    )) {
      const where = `${relative(APP_ROOT, file)}: ${utility}`
      usages.set(name, [...(usages.get(name) ?? []), where])
    }
  }
  return usages
}

describe('custom colour utilities', () => {
  it('each name a token the @theme block defines', () => {
    const tokens = themeColorTokens()
    const usages = customColorUsages()
    // A scan that matched nothing would pass vacuously.
    expect(usages.has('sideBarBackground')).toBe(true)

    const undefinedUsages = [...usages]
      .filter(([name]) => !tokens.has(name))
      .flatMap(([, where]) => where)
    expect(undefinedUsages).toEqual([])
  })
})
