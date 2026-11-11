import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../src/constants.js'

function workspacePackageDirs(): string[] {
  const workspace = readFileSync(
    path.join(REPO_ROOT, 'pnpm-workspace.yaml'),
    'utf8'
  )
  const block = /^packages:\n((?:\s+-\s+.*\n)+)/m.exec(workspace)?.[1] ?? ''
  return [...block.matchAll(/-\s+'([^']+)'/g)].map(([, dir]) => dir)
}

const published = workspacePackageDirs().filter(
  (dir) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8'))
      .private !== true
)

// Without either, pnpm 11 packs a package with the root ignore rules, which dropped the app's dist/index.html.
describe('published workspace packages', () => {
  it('are found in pnpm-workspace.yaml', () => {
    expect(published).toContain('packages/app')
    expect(published.length).toBeGreaterThanOrEqual(7)
  })

  it.each(published)('%s declares `files` or has its own .npmignore', (dir) => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8')
    )
    const ownRules =
      Array.isArray(manifest.files) ||
      existsSync(path.join(REPO_ROOT, dir, '.npmignore'))
    expect(ownRules, `${dir}: add a "files" list to package.json`).toBe(true)
  })

  it.each(published)('%s publishes every entry point it declares', (dir) => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8')
    )
    if (!Array.isArray(manifest.files)) {
      return
    }
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
