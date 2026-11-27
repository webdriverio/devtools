import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { relativeWithin, zipReader } from '../src/artifact-sources.js'

describe('relativeWithin', () => {
  const dir = path.resolve('run-dir')

  it('returns the path of a file inside the directory', () => {
    expect(relativeWithin(dir, path.join(dir, 'traces', 'a.zip'))).toBe(
      path.join('traces', 'a.zip')
    )
  })

  it('refuses a file that escapes the directory with ..', () => {
    expect(
      relativeWithin(dir, path.resolve(dir, '../elsewhere/a.zip'))
    ).toBeUndefined()
  })

  it('refuses a file elsewhere on disk', () => {
    expect(relativeWithin(dir, path.resolve('other', 'a.zip'))).toBeUndefined()
  })

  it('refuses a sibling whose name only starts with the directory name', () => {
    expect(relativeWithin(dir, path.join(`${dir}c`, 'a.zip'))).toBeUndefined()
  })

  it('allows a file whose name starts with two dots', () => {
    expect(relativeWithin(dir, path.join(dir, '..foo.zip'))).toBe('..foo.zip')
  })

  it('refuses the directory itself', () => {
    expect(relativeWithin(dir, dir)).toBeUndefined()
  })
})

describe('zipReader containment', () => {
  const dir = path.resolve('run-dir')
  const realpath = (target: string): string => target

  it('reads a zip inside the directory', () => {
    const loadZip = vi.fn(() => {
      throw new Error('stop after the containment check')
    })
    const warn = vi.fn()
    zipReader({ loadZip, realpath, warn }).read(path.join(dir, 'a.zip'), dir)
    expect(loadZip).toHaveBeenCalledWith(path.join(dir, 'a.zip'))
    expect(warn.mock.calls[0][0]).toContain('could not be read')
  })

  it('loads the zip from the real path that passed the containment check', () => {
    const real = path.join(dir, 'targets', 'a.zip')
    const loadZip = vi.fn(() => {
      throw new Error('stop after the containment check')
    })
    const warn = vi.fn()
    const reader = zipReader({
      loadZip,
      realpath: (target) =>
        target === path.join(dir, 'a.zip') ? real : target,
      warn
    })
    reader.read(path.join(dir, 'a.zip'), dir)
    expect(loadZip).toHaveBeenCalledWith(real)
  })

  it('refuses a zip that escapes the directory with ..', () => {
    const loadZip = vi.fn(() => new Uint8Array())
    const warn = vi.fn()
    const zip = path.resolve(dir, '../elsewhere/a.zip')
    const reader = zipReader({ loadZip, realpath, warn })
    expect(reader.read(zip, dir)).toBeUndefined()
    expect(loadZip).not.toHaveBeenCalled()
    expect(reader.unreadable()).toEqual([zip])
  })

  it('refuses a zip through a symlink whose real path is outside the directory', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'otel-zip-')))
    try {
      const manifestDir = path.join(root, 'results')
      const outside = path.join(root, 'outside')
      mkdirSync(manifestDir)
      mkdirSync(outside)
      writeFileSync(path.join(outside, 'trace.zip'), 'zip')
      symlinkSync(
        path.join(outside, 'trace.zip'),
        path.join(manifestDir, 'link.zip')
      )
      const loadZip = vi.fn(() => new Uint8Array())
      const warn = vi.fn()
      const reader = zipReader({ loadZip, realpath: realpathSync, warn })
      const link = path.join(manifestDir, 'link.zip')
      expect(reader.read(link, manifestDir)).toBeUndefined()
      expect(loadZip).not.toHaveBeenCalled()
      expect(warn.mock.calls[0][0]).toContain('outside the manifest directory')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a zip through an injected realpath that resolves outside the directory', () => {
    const loadZip = vi.fn(() => new Uint8Array())
    const warn = vi.fn()
    const reader = zipReader({
      loadZip,
      realpath: (target) =>
        target.endsWith('a.zip') ? path.resolve('elsewhere', 'a.zip') : target,
      warn
    })
    expect(reader.read(path.join(dir, 'a.zip'), dir)).toBeUndefined()
    expect(loadZip).not.toHaveBeenCalled()
  })

  it('reports a missing zip as unreadable rather than outside', () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'otel-zip-')))
    try {
      const warn = vi.fn()
      const reader = zipReader({
        loadZip: () => new Uint8Array(),
        realpath: realpathSync,
        warn
      })
      const missing = path.join(root, 'missing.zip')
      expect(reader.read(missing, root)).toBeUndefined()
      expect(warn.mock.calls[0][0]).toContain('could not be read')
      expect(reader.unreadable()).toEqual([missing])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
