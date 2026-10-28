import { describe, expect, it } from 'vitest'
import { isBrowserFetchable, parseCliArgs } from '../src/cli-args.js'

describe('parseCliArgs', () => {
  it('reads manifests and every push option', () => {
    expect(
      parseCliArgs([
        'push',
        'out/devtools-artifacts-a.json',
        'out/devtools-artifacts-b.json',
        '--artifact-base-url',
        'https://bucket.example/run',
        '--run-id=ci-42',
        '--dry-run'
      ])
    ).toEqual({
      help: false,
      manifests: [
        'out/devtools-artifacts-a.json',
        'out/devtools-artifacts-b.json'
      ],
      artifactBaseUrl: 'https://bucket.example/run',
      runId: 'ci-42',
      dryRun: true
    })
  })

  it('defaults to a real push with no run id or base url', () => {
    expect(parseCliArgs(['push', 'm.json'])).toEqual({
      help: false,
      manifests: ['m.json'],
      dryRun: false
    })
  })

  it('shows help with -h, --help, or no arguments', () => {
    expect(parseCliArgs(['-h']).help).toBe(true)
    expect(parseCliArgs(['push', '--help']).help).toBe(true)
    expect(parseCliArgs([]).help).toBe(true)
  })

  it('rejects an unknown command, an unknown option, a missing value and no manifest', () => {
    expect(() => parseCliArgs(['pull', 'm.json'])).toThrow(
      'unknown command "pull"'
    )
    expect(() => parseCliArgs(['push', 'm.json', '--force'])).toThrow(
      'unknown option "--force"'
    )
    expect(() => parseCliArgs(['push', 'm.json', '--run-id'])).toThrow(
      '--run-id needs a value'
    )
    expect(() => parseCliArgs(['push', '--dry-run'])).toThrow(
      'push needs at least one manifest path'
    )
  })
})

describe('isBrowserFetchable', () => {
  it('accepts http and https base URLs', () => {
    expect(isBrowserFetchable('https://traces.internal/run-1/')).toBe(true)
    expect(isBrowserFetchable('http://localhost:9000/traces/run-1')).toBe(true)
  })

  it('rejects bucket schemes and unparseable values', () => {
    expect(isBrowserFetchable('s3://traces/run-1')).toBe(false)
    expect(isBrowserFetchable('gs://traces/run-1')).toBe(false)
    expect(isBrowserFetchable('traces/run-1')).toBe(false)
  })
})
