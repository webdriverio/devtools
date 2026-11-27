import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { guardedRealPath } from '../src/local-paths.js'

const base = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'tq-paths-'))
)
const root = path.join(base, 'root')
const outside = path.join(base, 'outside')
fs.mkdirSync(path.join(root, 'run'), { recursive: true })
fs.mkdirSync(outside)
fs.writeFileSync(path.join(root, 'run', 'trace.zip'), 'zip')
fs.writeFileSync(path.join(outside, 'secret.zip'), 'zip')
fs.symlinkSync(path.join(outside, 'secret.zip'), path.join(root, 'link.zip'))
fs.symlinkSync(outside, path.join(root, 'out'))
fs.mkdirSync(path.join(base, 'root-sibling'))
fs.writeFileSync(path.join(base, 'root-sibling', 'a.zip'), 'zip')

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe('guardedRealPath', () => {
  it('resolves a file inside an allowed root', async () => {
    await expect(
      guardedRealPath(path.join(root, 'run', 'trace.zip'), [root])
    ).resolves.toBe(path.join(root, 'run', 'trace.zip'))
  })

  it('accepts the root itself', async () => {
    await expect(guardedRealPath(root, [root])).resolves.toBe(root)
  })

  it('refuses a path that escapes the root with ..', async () => {
    await expect(
      guardedRealPath(path.join(root, '..', 'outside', 'secret.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
  })

  it('refuses a symlink whose target is outside the root', async () => {
    await expect(
      guardedRealPath(path.join(root, 'link.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
  })

  it('refuses a sibling whose name only starts with the root', async () => {
    await expect(
      guardedRealPath(path.join(base, 'root-sibling', 'a.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
  })

  it('accepts a path inside any of several roots', async () => {
    await expect(
      guardedRealPath(path.join(outside, 'secret.zip'), [root, outside])
    ).resolves.toBe(path.join(outside, 'secret.zip'))
  })

  it('refuses every path when no root is configured', async () => {
    await expect(
      guardedRealPath(path.join(root, 'run', 'trace.zip'), [])
    ).rejects.toThrow('no allowed root is configured')
  })

  it('names a path inside a root that does not exist', async () => {
    await expect(
      guardedRealPath(path.join(root, 'missing.zip'), [root])
    ).rejects.toThrow(`Cannot open ${path.join(root, 'missing.zip')}: ENOENT`)
  })

  it('says only that a path outside every root is outside, whether or not it exists', async () => {
    await expect(
      guardedRealPath(path.join(outside, 'missing.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
    await expect(
      guardedRealPath(path.join(outside, 'secret.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
  })

  it('refuses to run with a root that cannot be resolved', async () => {
    await expect(
      guardedRealPath(path.join(root, 'run', 'trace.zip'), [
        path.join(base, 'nowhere'),
        root
      ])
    ).rejects.toThrow(
      `The allowed root ${path.join(base, 'nowhere')} cannot be resolved`
    )
  })

  it('gives one refusal through a symlink out of the root, whether or not the file exists', async () => {
    await expect(
      guardedRealPath(path.join(root, 'out', 'secret.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
    await expect(
      guardedRealPath(path.join(root, 'out', 'missing.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
    await expect(
      guardedRealPath(path.join(root, 'out', 'nested', 'missing.zip'), [root])
    ).rejects.toThrow('outside the allowed roots')
  })
})
