import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TestReporter } from '../src/reporter.js'
import type { TestStats, SuiteStats } from '@wdio/reporter'

describe('TestReporter - Rerun & Stable UID', () => {
  let reporter: TestReporter
  let sendUpstream: ReturnType<typeof vi.fn>

  const createTestStats = (overrides: Partial<TestStats> = {}): TestStats =>
    ({
      uid: 'test-123',
      title: 'should login',
      fullTitle: 'Login Suite should login',
      file: '/test/login.spec.ts',
      parent: 'suite-1',
      cid: '0-0',
      ...overrides
    }) as TestStats

  const createSuiteStats = (overrides: Partial<SuiteStats> = {}): SuiteStats =>
    ({
      uid: 'suite-123',
      title: 'Login Suite',
      fullTitle: 'Login Suite',
      file: '/test/login.spec.ts',
      cid: '0-0',
      ...overrides
    }) as SuiteStats

  beforeEach(() => {
    sendUpstream = vi.fn()
    reporter = new TestReporter(
      { logFile: '/tmp/test.log' },
      sendUpstream as any
    )
  })

  describe('stable UID generation for reruns', () => {
    it('should generate consistent UIDs for test reruns', () => {
      const testStats1 = createTestStats()
      const testStats2 = createTestStats({ uid: 'test-456' })

      reporter.onTestStart(testStats1)
      const uid1 = (testStats1 as any).uid

      reporter = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any
      )
      reporter.onTestStart(testStats2)
      const uid2 = (testStats2 as any).uid

      expect(uid1).toBe(uid2)
      expect(uid1).toContain('stable-')
    })

    it('should generate unique UIDs for different tests', () => {
      const tests = [
        createTestStats({
          uid: 'test-1',
          title: 'test A',
          fullTitle: 'Suite test A'
        }),
        createTestStats({
          uid: 'test-2',
          title: 'test B',
          fullTitle: 'Suite test B'
        })
      ]

      tests.forEach((test) => reporter.onTestStart(test))

      expect((tests[0] as any).uid).not.toBe((tests[1] as any).uid)
    })

    it('should handle suite stable UIDs for reruns', () => {
      const suite1 = createSuiteStats()
      const suite2 = createSuiteStats({ uid: 'suite-456' })

      reporter.onSuiteStart(suite1)
      const uid1 = (suite1 as any).uid

      reporter = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any
      )
      reporter.onSuiteStart(suite2)
      const uid2 = (suite2 as any).uid

      expect(uid1).toBe(uid2)
    })
  })

  describe('Cucumber feature file tracking for reruns', () => {
    it('should capture feature file and line for Cucumber tests', () => {
      const testStats = createTestStats({
        uid: 'test-1',
        title: 'Login scenario',
        fullTitle: 'Login scenario',
        file: '/test/login.feature',
        argument: { uri: '/test/features/login.feature', line: 15 } as any
      })

      reporter.onTestStart(testStats)

      expect((testStats as any).featureFile).toBe(
        '/test/features/login.feature'
      )
      expect((testStats as any).featureLine).toBe(15)
    })

    it('should call reporter methods without errors', () => {
      const testStats = createTestStats({
        uid: 'test-1',
        title: 'test',
        fullTitle: 'test',
        file: '/test.spec.ts',
        parent: 'suite'
      })

      expect(() => {
        reporter.onTestStart(testStats)
        reporter.onTestEnd(testStats)
      }).not.toThrow()
    })
  })
})
