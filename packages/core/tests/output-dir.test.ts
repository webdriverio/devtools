import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAdapterOutputDir } from '../src/output-dir.js'

describe('resolveAdapterOutputDir', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-dir-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns userConfiguredDir verbatim when set, even if non-existent', () => {
    expect(
      resolveAdapterOutputDir({ userConfiguredDir: '/whatever/path' })
    ).toBe('/whatever/path')
  })

  it('prefers testFilePath dir over configPath dir over fallback', () => {
    const testFile = path.join(tmpDir, 'specs', 'login.test.ts')
    fs.mkdirSync(path.dirname(testFile), { recursive: true })
    fs.writeFileSync(testFile, '')
    const configPath = path.join(tmpDir, 'config', 'nightwatch.conf.cjs')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, '')

    expect(
      resolveAdapterOutputDir({
        testFilePath: testFile,
        configPath,
        fallbackDir: tmpDir
      })
    ).toBe(path.dirname(testFile))
  })

  it('falls back to configPath dir when testFilePath is missing', () => {
    const configPath = path.join(tmpDir, 'wdio.conf.ts')
    fs.writeFileSync(configPath, '')
    expect(resolveAdapterOutputDir({ configPath, fallbackDir: tmpDir })).toBe(
      tmpDir
    )
  })

  it('skips node_modules dirs and falls through to the next candidate', () => {
    const nodeModulesDir = path.join(tmpDir, 'node_modules', 'pkg', 'specs')
    fs.mkdirSync(nodeModulesDir, { recursive: true })
    const testFile = path.join(nodeModulesDir, 'a.test.ts')
    fs.writeFileSync(testFile, '')
    const configPath = path.join(tmpDir, 'wdio.conf.ts')
    fs.writeFileSync(configPath, '')

    expect(
      resolveAdapterOutputDir({
        testFilePath: testFile,
        configPath
      })
    ).toBe(tmpDir)
  })

  it('falls back to process.cwd() when no inputs are given', () => {
    expect(resolveAdapterOutputDir()).toBe(process.cwd())
  })

  it('falls back to fallbackDir when given and none of the candidates are writable', () => {
    expect(
      resolveAdapterOutputDir({
        testFilePath: '/definitely/missing/a.test.ts',
        fallbackDir: tmpDir
      })
    ).toBe(tmpDir)
  })

  it('userConfiguredDir bypasses node_modules skip (explicit opt-in)', () => {
    const nm = '/some/node_modules/pkg/dir'
    expect(resolveAdapterOutputDir({ userConfiguredDir: nm })).toBe(nm)
  })

  it('returns fallback (cwd) when all candidate dirs are missing', () => {
    expect(
      resolveAdapterOutputDir({
        testFilePath: '/missing/x.test.ts',
        configPath: '/missing/wdio.conf.ts'
      })
    ).toBe(process.cwd())
  })
})
