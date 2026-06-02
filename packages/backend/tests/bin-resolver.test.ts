import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RUNNER_ENV } from '@wdio/devtools-shared'
import { resolveNightwatchBin, resolveWdioBin } from '../src/bin-resolver.js'

let tmpDir: string
let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-resolver-'))
  // Snapshot the resolver-relevant env so each test starts clean.
  savedEnv = { ...process.env }
  delete process.env[RUNNER_ENV.NIGHTWATCH_BIN]
  delete process.env[RUNNER_ENV.WDIO_BIN]
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.env = savedEnv
})

// Lay out a minimal node_modules/nightwatch/{package.json + bin/nightwatch.js}
function plantNightwatch(at: string, binEntry: unknown = 'bin/nightwatch.js') {
  const pkgDir = path.join(at, 'node_modules', 'nightwatch')
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: 'nightwatch', bin: binEntry })
  )
  fs.writeFileSync(
    path.join(pkgDir, 'bin', 'nightwatch.js'),
    '#!/usr/bin/env node\n'
  )
  return path.join(pkgDir, 'bin', 'nightwatch.js')
}

describe('resolveNightwatchBin — env override (DEVTOOLS_NIGHTWATCH_BIN)', () => {
  it('honors an absolute env override that exists on disk', () => {
    const fake = path.join(tmpDir, 'my-nightwatch.js')
    fs.writeFileSync(fake, '')
    process.env[RUNNER_ENV.NIGHTWATCH_BIN] = fake
    expect(resolveNightwatchBin('/anywhere')).toBe(fake)
  })

  it('honors a relative env override (resolved from cwd)', () => {
    const fake = path.join(tmpDir, 'rel-nightwatch.js')
    fs.writeFileSync(fake, '')
    // Make the override relative by stripping cwd off the path
    const rel = path.relative(process.cwd(), fake)
    process.env[RUNNER_ENV.NIGHTWATCH_BIN] = rel
    expect(resolveNightwatchBin('/anywhere')).toBe(path.resolve(rel))
  })

  it('falls through to walk-up when the env-override path does not exist', () => {
    process.env[RUNNER_ENV.NIGHTWATCH_BIN] = '/totally/missing.js'
    const expected = plantNightwatch(tmpDir)
    expect(resolveNightwatchBin(tmpDir)).toBe(expected)
  })
})

describe('resolveNightwatchBin — walk-up node_modules search', () => {
  it('finds nightwatch when planted in the start directory', () => {
    const expected = plantNightwatch(tmpDir)
    expect(resolveNightwatchBin(tmpDir)).toBe(expected)
  })

  it('walks up parent directories until it finds node_modules/nightwatch', () => {
    const child = path.join(tmpDir, 'a', 'b', 'c')
    fs.mkdirSync(child, { recursive: true })
    const expected = plantNightwatch(tmpDir)
    expect(resolveNightwatchBin(child)).toBe(expected)
  })

  it('supports object-form bin: { nightwatch: ... }', () => {
    const expected = plantNightwatch(tmpDir, {
      nightwatch: 'bin/nightwatch.js'
    })
    expect(resolveNightwatchBin(tmpDir)).toBe(expected)
  })

  it('supports object-form bin: { nw: ... } as a fallback', () => {
    const pkgDir = path.join(tmpDir, 'node_modules', 'nightwatch')
    fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'nightwatch', bin: { nw: 'bin/nw-entry.js' } })
    )
    fs.writeFileSync(path.join(pkgDir, 'bin', 'nw-entry.js'), '')
    expect(resolveNightwatchBin(tmpDir)).toBe(
      path.join(pkgDir, 'bin', 'nw-entry.js')
    )
  })

  it('throws a helpful error mentioning DEVTOOLS_NIGHTWATCH_BIN when nothing is found', () => {
    // tmpDir has no nightwatch planted; walk-up hits filesystem root
    expect(() => resolveNightwatchBin(tmpDir)).toThrow(
      /DEVTOOLS_NIGHTWATCH_BIN/
    )
  })

  it('skips malformed package.json silently and continues walking', () => {
    const child = path.join(tmpDir, 'inner')
    fs.mkdirSync(path.join(child, 'node_modules', 'nightwatch'), {
      recursive: true
    })
    // Write garbage JSON at the inner level
    fs.writeFileSync(
      path.join(child, 'node_modules', 'nightwatch', 'package.json'),
      '{ this is not valid json'
    )
    // Plant a valid one at the parent level
    const expected = plantNightwatch(tmpDir)
    expect(resolveNightwatchBin(child)).toBe(expected)
  })
})

describe('resolveWdioBin — env override (DEVTOOLS_WDIO_BIN)', () => {
  it('honors an absolute env override that exists', () => {
    const fake = path.join(tmpDir, 'my-wdio.js')
    fs.writeFileSync(fake, '')
    process.env[RUNNER_ENV.WDIO_BIN] = fake
    expect(resolveWdioBin()).toBe(fake)
  })

  it('throws a helpful error when env-override path does NOT exist (does NOT fall back to require.resolve)', () => {
    process.env[RUNNER_ENV.WDIO_BIN] = '/totally/missing-wdio.js'
    expect(() => resolveWdioBin()).toThrow(/does not exist|not accessible/)
  })

  it('resolves a relative env override from cwd', () => {
    const fake = path.join(tmpDir, 'rel-wdio.js')
    fs.writeFileSync(fake, '')
    const rel = path.relative(process.cwd(), fake)
    process.env[RUNNER_ENV.WDIO_BIN] = rel
    expect(resolveWdioBin()).toBe(path.resolve(rel))
  })
})

describe('resolveWdioBin — @wdio/cli derivation', () => {
  // @wdio/cli IS installed in this workspace (a real dep), so the derivation
  // succeeds and returns the published bin path. We assert the file exists +
  // looks like the wdio entry, without locking to a specific absolute path
  // that varies per machine.
  it('derives bin/wdio.js from @wdio/cli when no env override is set', () => {
    const resolved = resolveWdioBin()
    expect(resolved.endsWith('bin/wdio.js')).toBe(true)
    expect(fs.existsSync(resolved)).toBe(true)
  })
})
