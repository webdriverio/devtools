import { describe, expect, it } from 'vitest'
import {
  artifactsManifestFilename,
  isArtifactsManifestFilename,
  retryKeyOf
} from '../src/artifacts-manifest.js'

describe('artifactsManifestFilename', () => {
  it('names a session manifest', () => {
    expect(artifactsManifestFilename('abc')).toBe('devtools-artifacts-abc.json')
  })

  it('writes a name its predicate recognises', () => {
    expect(isArtifactsManifestFilename(artifactsManifestFilename('s1'))).toBe(
      true
    )
  })
})

describe('isArtifactsManifestFilename', () => {
  it.each([
    'devtools-artifacts-.json',
    'devtools-artifacts-s1.json.bak',
    'artifacts-s1.json',
    'devtools-artifacts-s1.zip',
    'trace.zip'
  ])('rejects %s', (name) => {
    expect(isArtifactsManifestFilename(name)).toBe(false)
  })
})

describe('retryKeyOf', () => {
  it('keeps the bare uid for the first attempt', () => {
    expect(retryKeyOf('u1', 0)).toBe('u1')
  })

  it('suffixes a retry', () => {
    expect(retryKeyOf('u1', 2)).toBe('u1-retry2')
  })
})
