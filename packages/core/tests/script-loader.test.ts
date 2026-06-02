import { describe, it, expect, vi } from 'vitest'
import { pollUntilReady } from '../src/script-loader.js'

describe('pollUntilReady', () => {
  it('returns true as soon as the check succeeds', async () => {
    let calls = 0
    const ok = await pollUntilReady(
      async () => {
        calls++
        return calls === 2
      },
      { attempts: 5, intervalMs: 1 }
    )
    expect(ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('returns false when no attempt succeeds', async () => {
    const check = vi.fn(async () => false)
    const ok = await pollUntilReady(check, { attempts: 3, intervalMs: 1 })
    expect(ok).toBe(false)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('uses default 5 attempts × 200ms when no opts given', async () => {
    const check = vi.fn(async () => false)
    const start = process.hrtime.bigint()
    const ok = await pollUntilReady(check)
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000
    expect(ok).toBe(false)
    expect(check).toHaveBeenCalledTimes(5)
    // 5 × 200ms = 1000ms, allow generous slack for CI
    expect(elapsedMs).toBeGreaterThanOrEqual(950)
  })

  it('does not call the check before the first interval', async () => {
    const check = vi.fn(async () => true)
    await pollUntilReady(check, { attempts: 1, intervalMs: 50 })
    expect(check).toHaveBeenCalledTimes(1)
  })
})
