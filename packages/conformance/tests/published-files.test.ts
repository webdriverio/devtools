import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../src/constants.js'

function workspacePackageDirs(): string[] {
  return listedPackages(
    readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  )
}

function listedPackages(workspace: string): string[] {
  const lines = workspace.split('\n')
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line))
  const dirs: string[] = []
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (/^\S/.test(line)) {
      break
    }
    const entry = /^\s+-\s+(['"]?)([^'"#\s]+)\1\s*(?:#.*)?$/.exec(line)
    if (entry) {
      dirs.push(entry[2])
    }
  }
  return dirs
}

const published = workspacePackageDirs().filter(
  (dir) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8'))
      .private !== true
)

describe('the pnpm-workspace.yaml reader', () => {
  it('reads quoted and unquoted entries and skips comments', () => {
    const workspace = [
      'packages:',
      "  - 'packages/a'",
      '  # a comment',
      '  - packages/b # why b',
      '  - "packages/c"',
      '',
      'overrides:',
      '  - not-a-package'
    ].join('\n')
    expect(listedPackages(workspace)).toEqual([
      'packages/a',
      'packages/b',
      'packages/c'
    ])
  })
})

// Without `files`, pnpm 11 packs with the root .gitignore, which ignores dist/.
describe('published workspace packages', () => {
  it('are found in pnpm-workspace.yaml', () => {
    expect(published).toContain('packages/app')
    expect(published.length).toBeGreaterThanOrEqual(7)
  })

  it.each(published)('%s declares `files` and no .npmignore', (dir) => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8')
    )
    expect(
      Array.isArray(manifest.files),
      `${dir}: add a "files" list to package.json`
    ).toBe(true)
    expect(
      existsSync(path.join(REPO_ROOT, dir, '.npmignore')),
      `${dir}: delete .npmignore, "files" decides`
    ).toBe(false)
  })

  it.each(published)('%s publishes every entry point it declares', (dir) => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8')
    )
    const roots = (manifest.files as string[]).map(normalize)
    const unpublished = entryTargets(manifest).filter(
      (target) =>
        !roots.some((root) => target === root || target.startsWith(`${root}/`))
    )
    expect(unpublished, `${dir}: entry points outside "files"`).toEqual([])
  })
})

function normalize(target: string): string {
  return path.posix.normalize(target).replace(/\/$/, '')
}

function entryTargets(manifest: Record<string, unknown>): string[] {
  const targets: string[] = []
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      targets.push(normalize(value))
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect)
    }
  }
  for (const field of [
    'main',
    'module',
    'types',
    'typings',
    'exports',
    'bin'
  ]) {
    collect(manifest[field])
  }
  return targets
}
