import { describe, it, expect } from 'vitest'
import {
  applyPerformanceData,
  type CapturedPerformancePayload
} from '../src/performance-capture.js'
import type { CommandLog } from '@wdio/devtools-shared'

const freshCommand = (): CommandLog => ({
  command: 'url',
  args: ['https://example.com'],
  result: undefined,
  timestamp: 1000
})

describe('applyPerformanceData', () => {
  it('returns false and mutates nothing when payload is missing or has no navigation', () => {
    const cmd = freshCommand()
    expect(applyPerformanceData(cmd, undefined)).toBe(false)
    expect(applyPerformanceData(cmd, { resources: [] })).toBe(false)
    expect(cmd.performance).toBeUndefined()
  })

  it('applies all fields (performance/cookies/documentInfo + synthesized result) when navigation is present', () => {
    const cmd = freshCommand()
    const payload: CapturedPerformancePayload = {
      navigation: {
        url: 'https://payload.com',
        timing: { loadTime: 1234 } as unknown as never
      },
      resources: [
        {
          url: 'a.js',
          duration: 1,
          size: 1,
          type: 'script',
          startTime: 0,
          responseEnd: 1
        }
      ],
      cookies: 'session=x',
      documentInfo: {
        url: 'https://payload.com',
        title: 'T',
        headers: { userAgent: '', language: '', platform: '' },
        documentInfo: { readyState: 'complete', referrer: '', characterSet: '' }
      }
    }
    expect(applyPerformanceData(cmd, payload, 'https://from-arg.com')).toBe(
      true
    )
    expect(cmd.performance?.navigation?.timing?.loadTime).toBe(1234)
    expect(cmd.cookies).toBe('session=x')
    expect(cmd.documentInfo?.title).toBe('T')
    // result.url comes from the navigatedUrl argument, NOT the payload URL
    expect((cmd.result as Record<string, unknown>).url).toBe(
      'https://from-arg.com'
    )
    expect((cmd.result as Record<string, unknown>).resourceCount).toBe(1)
  })
})
