import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageVersionOf } from '../src/package-version.js'

function fixturePackage(name: string, version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'elements-pkg-'))
  mkdirSync(join(root, 'build'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version }))
  const entry = join(root, 'build', 'index.js')
  writeFileSync(entry, '')
  return entry
}

describe('packageVersionOf', () => {
  it('reads the version of the named package above the resolved file', () => {
    const entry = fixturePackage('@wdio/snapshot', '10.1.0')

    expect(packageVersionOf(entry, '@wdio/snapshot')).toBe('10.1.0')
  })

  it('returns undefined when the nearest package has another name', () => {
    const entry = fixturePackage('@wdio/other', '10.2.0')

    expect(packageVersionOf(entry, '@wdio/snapshot')).toBeUndefined()
  })

  it('reads the installed @wdio/snapshot through its resolved entry', () => {
    const entry = fileURLToPath(import.meta.resolve('@wdio/snapshot'))

    expect(packageVersionOf(entry, '@wdio/snapshot')).toMatch(/^\d+\.\d+\./)
  })
})
