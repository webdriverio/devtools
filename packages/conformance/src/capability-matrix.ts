// `pnpm docs:capabilities [--check] [--website <webdriverio checkout>]`: renders the capability tables.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { validateCapabilities } from './capability-validation.js'
import { CAPABILITY_TABLES, README_PAGE, REPO_ROOT } from './constants.js'
import { replaceBlock } from './render-capabilities.js'
import type { CapabilityTable, CapabilityTarget } from './types.js'

export function targetsFor(websiteRoot?: string): CapabilityTarget[] {
  return (
    Object.entries(CAPABILITY_TABLES) as [CapabilityTable, string][]
  ).flatMap(([table, page]) => {
    if (page === README_PAGE) {
      return [{ table, file: path.join(REPO_ROOT, page) }]
    }
    return websiteRoot ? [{ table, file: path.join(websiteRoot, page) }] : []
  })
}

/** Each file with every one of its tables rendered; throws before anything is written if any target cannot be. */
export function renderFiles(
  targets: CapabilityTarget[]
): Map<string, { current: string; next: string }> {
  const files = new Map<string, { current: string; next: string }>()
  const problems: string[] = []
  for (const { table, file } of targets) {
    if (!files.has(file)) {
      if (!existsSync(file)) {
        problems.push(`${file}: not found`)
        continue
      }
      const current = readFileSync(file, 'utf8')
      files.set(file, { current, next: current })
    }
    const entry = files.get(file)
    if (!entry) {
      continue
    }
    try {
      entry.next = replaceBlock(entry.next, table)
    } catch (err) {
      problems.push(`${file}: ${(err as Error).message}`)
    }
  }
  if (problems.length) {
    throw new Error(problems.join('\n'))
  }
  return files
}

/** The files whose tables differ from the declared source, rewritten unless `check` is set. */
export function syncTables(
  targets: CapabilityTarget[],
  check: boolean
): string[] {
  const stale = [...renderFiles(targets)].filter(
    ([, { current, next }]) => current !== next
  )
  if (!check) {
    for (const [file, { next }] of stale) {
      writeFileSync(file, next)
    }
  }
  return stale.map(([file]) => file)
}

/** `--website <dir>` or `--website=<dir>`; the value must not be another flag. */
export function parseArgs(argv: string[]): {
  check: boolean
  websiteRoot?: string
} {
  let check = false
  let websiteRoot: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') {
      check = true
    } else if (arg === '--website' || arg.startsWith('--website=')) {
      const value =
        arg === '--website' ? argv[++i] : arg.slice('--website='.length)
      if (!value || value.startsWith('--')) {
        throw new Error('--website needs the path of a webdriverio checkout')
      }
      websiteRoot = path.resolve(value)
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  return { check, websiteRoot }
}

function main(argv: string[]): number {
  try {
    const problems = validateCapabilities()
    if (problems.length) {
      throw new Error(`capabilities.ts is invalid:\n  ${problems.join('\n  ')}`)
    }
    const { check, websiteRoot } = parseArgs(argv)
    const stale = syncTables(targetsFor(websiteRoot), check)
    for (const file of stale) {
      console.log(`${check ? 'out of date' : 'updated'}: ${file}`)
    }
    return check && stale.length ? 1 : 0
  } catch (err) {
    console.error(`docs:capabilities: ${(err as Error).message}`)
    return 1
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  process.exitCode = main(process.argv.slice(2))
}
