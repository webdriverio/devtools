import { describe, it, expect } from 'vitest'
import {
  buildSourceResources,
  callSourceToStack,
  sha1Hex,
  sourceResourceName
} from '@wdio/devtools-core'

describe('callSourceToStack', () => {
  it('parses <file>:<line> into a single frame', () => {
    expect(callSourceToStack('/specs/login.ts:42')).toEqual([
      { file: '/specs/login.ts', line: 42, column: 0 }
    ])
  })

  it('parses <file>:<line>:<column> into a single frame', () => {
    expect(callSourceToStack('/specs/steps.ts:17:21')).toEqual([
      { file: '/specs/steps.ts', line: 17, column: 21 }
    ])
  })

  it('keeps windows-style drive paths intact', () => {
    expect(callSourceToStack('C:\\specs\\login.ts:7')).toEqual([
      { file: 'C:\\specs\\login.ts', line: 7, column: 0 }
    ])
  })

  it('parses windows-style paths with line and column', () => {
    expect(callSourceToStack('C:\\specs\\login.ts:7:5')).toEqual([
      { file: 'C:\\specs\\login.ts', line: 7, column: 5 }
    ])
  })

  it('returns undefined for missing or unknown call sources', () => {
    expect(callSourceToStack(undefined)).toBeUndefined()
    expect(callSourceToStack('unknown:0')).toBeUndefined()
  })

  it('falls back to line 0 when no numeric suffix exists', () => {
    expect(callSourceToStack('plainfile')).toEqual([
      { file: 'plainfile', line: 0, column: 0 }
    ])
  })
})

describe('buildSourceResources', () => {
  it('writes each source under its path-addressed resource name', () => {
    const resources = buildSourceResources({
      '/specs/login.ts': 'it("logs in")'
    })
    expect(resources).toEqual([
      {
        resourceName: `src@${sha1Hex('/specs/login.ts')}.txt`,
        data: Buffer.from('it("logs in")', 'utf8')
      }
    ])
    expect(resources[0]!.resourceName).toBe(
      sourceResourceName('/specs/login.ts')
    )
  })

  it('skips sources above the size cap', () => {
    const resources = buildSourceResources({
      '/big.js': 'x'.repeat(2 * 1024 * 1024 + 1),
      '/small.ts': 'ok'
    })
    expect(resources.map((r) => r.resourceName)).toEqual([
      sourceResourceName('/small.ts')
    ])
  })
})
