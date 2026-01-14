/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NetworkRequestCollector } from '../src/collectors/networkRequests.js'

describe('NetworkRequestCollector', () => {
  let collector: NetworkRequestCollector

  beforeEach(() => {
    collector = new NetworkRequestCollector()
  })

  afterEach(() => {
    collector.clear()
  })

  it('should initialize, clear, and return artifacts correctly', () => {
    // Test initialization
    const artifacts = collector.getArtifacts()
    expect(artifacts).toEqual([])
    expect(Array.isArray(artifacts)).toBe(true)
    expect(artifacts).toHaveLength(0)

    // Test clear functionality
    collector.clear()
    const clearedArtifacts = collector.getArtifacts()
    expect(clearedArtifacts).toEqual([])
    expect(clearedArtifacts).toHaveLength(0)

    // Test multiple clears are safe
    collector.clear()
    expect(collector.getArtifacts()).toEqual([])

    // Test reference consistency
    const artifacts1 = collector.getArtifacts()
    const artifacts2 = collector.getArtifacts()
    expect(artifacts1).toBe(artifacts2)
    expect(artifacts1).toBeDefined()
    expect(artifacts1).not.toBeNull()
  })
})
