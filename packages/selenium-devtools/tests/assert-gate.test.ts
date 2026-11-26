import assert from 'node:assert'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/helpers/detachedBackend.js', () => ({
  startDetachedBackend: vi.fn()
}))

const { DevTools } = await import('../src/index.js')

function failureMessage(): string {
  try {
    assert.strict.equal('Example Domain', 'This Is Not The Heading')
  } catch (err) {
    return (err as Error).message
  }
  return ''
}

describe('node:assert patch per mode', () => {
  it("leaves a telemetry run's assertion error as node wrote it, and rewrites it in trace mode", () => {
    DevTools.configure({ mode: 'trace' })
    expect(failureMessage()).toContain("Expected: 'This Is Not The Heading'")
    DevTools.configure({ mode: 'telemetry' })
    expect(failureMessage()).not.toContain(
      "Expected: 'This Is Not The Heading'"
    )
  })

  it('rewrites the assertion error in trace mode even with captureAssertions off', () => {
    DevTools.configure({ mode: 'trace', captureAssertions: false })
    expect(failureMessage()).toContain("Expected: 'This Is Not The Heading'")
  })
})
