import { describe, it, expect } from 'vitest'
import {
  deterministicUid,
  generateStableUid,
  isStepUidOf,
  resetSignatureCounters,
  stepMetadataUid,
  stepOwnerUid
} from '@wdio/devtools-core'

describe('deterministicUid', () => {
  it('is stable across calls and distinct per input', () => {
    expect(deterministicUid('/a.js', 'logs in')).toBe(
      deterministicUid('/a.js', 'logs in')
    )
    expect(deterministicUid('/a.js', 'logs in')).not.toBe(
      deterministicUid('/a.js', 'logs out')
    )
  })

  it('separates parts so a shifted split hashes differently', () => {
    expect(deterministicUid('ab', 'c')).not.toBe(deterministicUid('a', 'bc'))
  })
})

describe('generateStableUid', () => {
  it('disambiguates repeated (file, name) pairs within one run', () => {
    resetSignatureCounters()
    const first = generateStableUid('/a.js', 'logs in')
    const second = generateStableUid('/a.js', 'logs in')
    expect(second).not.toBe(first)
    resetSignatureCounters()
    expect(generateStableUid('/a.js', 'logs in')).toBe(first)
  })
})

describe('stepMetadataUid / isStepUidOf', () => {
  it('derives a key that reports its owning test', () => {
    const uid = stepMetadataUid('stable-abc', 2)
    expect(uid).toBe('stable-abc:step:2')
    expect(isStepUidOf(uid, 'stable-abc')).toBe(true)
  })

  it('gives each index its own key', () => {
    expect(stepMetadataUid('stable-abc', 1)).not.toBe(
      stepMetadataUid('stable-abc', 2)
    )
  })

  it('does not claim a step of a test whose uid merely shares a prefix', () => {
    expect(isStepUidOf(stepMetadataUid('stable-abcd', 1), 'stable-abc')).toBe(
      false
    )
  })

  it('does not treat the test uid itself as one of its steps', () => {
    expect(isStepUidOf('stable-abc', 'stable-abc')).toBe(false)
  })
})

describe('stepOwnerUid', () => {
  it('returns the owning test uid for a step key', () => {
    expect(stepOwnerUid(stepMetadataUid('stable-abc', 2))).toBe('stable-abc')
  })

  it('returns undefined for a uid that is not a step key', () => {
    expect(stepOwnerUid('abc')).toBeUndefined()
    expect(stepOwnerUid('abc:step:')).toBeUndefined()
    expect(stepOwnerUid('abc:step:x')).toBeUndefined()
  })

  it('resolves one level of a nested key', () => {
    expect(stepOwnerUid('a:step:1:step:2')).toBe('a:step:1')
  })
})
