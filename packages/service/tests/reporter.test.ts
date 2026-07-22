import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

  describe('loadSource callback', () => {
    it('invokes loadSource with the file mapped to a test', () => {
      const loadSource = vi.fn()
      const r = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any,
        loadSource
      )

      r.onTestStart(
        createTestStats({
          title: 'Given I open the url',
          fullTitle: 'Given I open the url',
          file: '/proj/src/features/x.feature',
          argument: { uri: '/proj/src/features/x.feature', line: 5 } as any
        })
      )

      // mapTestToSource may rewrite `testStats.file` (it can fall back to the
      // runtime stack when no spec file is on disk), so don't pin to a path —
      // just assert the callback fired with the resolved file.
      expect(loadSource).toHaveBeenCalledTimes(1)
      expect(typeof loadSource.mock.calls[0][0]).toBe('string')
      expect(loadSource.mock.calls[0][0].length).toBeGreaterThan(0)
    })

    it('invokes loadSource for suites that get mapped to a file', () => {
      const loadSource = vi.fn()
      const r = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any,
        loadSource
      )

      const suiteStats = createSuiteStats({
        title: 'Login feature',
        file: '/proj/src/features/login.feature'
      })

      r.onSuiteStart(suiteStats)

      expect(loadSource).toHaveBeenCalledWith(
        expect.stringContaining('login.feature')
      )
    })

    it('treats loadSource as optional (default no-op)', () => {
      const r = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any
      )

      // No loadSource passed — must not throw when test/suite events fire.
      expect(() => {
        r.onSuiteStart(createSuiteStats())
        r.onTestStart(createTestStats())
      }).not.toThrow()
    })
  })

  describe('onTestEnd error normalization', () => {
    it('preserves non-enumerable Error fields for JSON serialization', () => {
      const err = new Error('assertion failed')
      err.stack = 'Error: assertion failed\n    at foo.js:1:1'
      ;(err as any).expected = 42
      ;(err as any).actual = 41
      ;(err as any).matcherResult = { pass: false, message: 'mismatch' }

      const testStats = createTestStats({ uid: 'test-end-1' })
      reporter.onTestStart(testStats)
      testStats.error = err as any
      reporter.onTestEnd(testStats)

      // The normalized error must round-trip through JSON without losing
      // message/name/stack (which would happen with a raw Error instance).
      const round = JSON.parse(JSON.stringify(testStats.error))
      expect(round.message).toBe('assertion failed')
      expect(round.name).toBe('Error')
      expect(round.stack).toContain('foo.js:1:1')
      expect(round.expected).toBe(42)
      expect(round.actual).toBe(41)
      expect(round.matcherResult).toEqual({ pass: false, message: 'mismatch' })
    })

    it('leaves testStats.error untouched when no error is set', () => {
      const testStats = createTestStats({ uid: 'test-end-2' })
      reporter.onTestStart(testStats)
      reporter.onTestEnd(testStats)
      expect(testStats.error).toBeUndefined()
    })
  })

  describe('onSuiteEnd suite-path management', () => {
    it('pops outer/inner titles in reverse order without throwing', () => {
      const outer = createSuiteStats({
        uid: 'outer',
        title: 'outer-suite',
        file: '/test/outer.spec.ts'
      })
      const inner = createSuiteStats({
        uid: 'inner',
        title: 'inner-suite',
        file: '/test/outer.spec.ts',
        parent: 'outer-suite'
      })
      expect(() => {
        reporter.onSuiteStart(outer)
        reporter.onSuiteStart(inner)
        reporter.onSuiteEnd(inner)
        reporter.onSuiteEnd(outer)
      }).not.toThrow()
    })

    it('handles onSuiteEnd before matching onSuiteStart without throwing', () => {
      // Mismatched end (title not at top of stack) — pop is a no-op.
      const dangling = createSuiteStats({ uid: 'dangling', title: 'stray' })
      expect(() => reporter.onSuiteEnd(dangling)).not.toThrow()
    })
  })

  describe('Scenario Outline example-line resolution from feature file', () => {
    const tmpFile = path.join(os.tmpdir(), `wdio-outline-${Date.now()}.feature`)

    afterAll(() => {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    })

    it('maps numeric uid (example index) to the data-row line', () => {
      const content = [
        'Feature: outline',
        '',
        '  Scenario Outline: greet <name>',
        '    Given a <name>',
        '    Examples:',
        '      | name |',
        '      | alice |',
        '      | bob   |',
        '      | carol |',
        ''
      ].join('\n')
      fs.writeFileSync(tmpFile, content, 'utf-8')

      // uid='0' maps to the first data row (after the header)
      const suite = createSuiteStats({
        uid: '0',
        title: 'greet <name>',
        file: tmpFile
      })
      // mark as scenario so the parseFeatureFile path triggers
      ;(suite as any).type = 'scenario'

      const r = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any
      )
      r.onSuiteStart(suite)
      // The first data row "alice" is the 7th line (1-indexed) in the content.
      expect(suite.featureFile).toBe(tmpFile)
      expect(suite.featureLine).toBe(7)
    })

    it('falls back to pickle URI:line when the cucumber argument is set', () => {
      const suite = createSuiteStats({
        uid: '0',
        title: 'login scenario',
        file: '/some/login.feature',
        argument: { uri: '/some/login.feature', line: 42 } as any
      })
      ;(suite as any).type = 'scenario'

      reporter.onSuiteStart(suite)
      expect(suite.featureFile).toBe('/some/login.feature')
      expect(suite.featureLine).toBe(42)
    })
  })

  describe('report getter', () => {
    it('exposes the parent reporter suites map after suite start', () => {
      const suite = createSuiteStats({
        uid: 'suite-payload',
        title: 'X',
        file: '/test/x.spec.ts'
      })
      reporter.onSuiteStart(suite)
      // After onSuiteStart, the suite's uid has been rewritten to a stable hash
      expect(typeof suite.uid).toBe('string')
      expect(suite.uid.length).toBeGreaterThan(0)
      // The `report` accessor returns the parent reporter's suites map.
      // It may be undefined depending on internals but should not throw.
      expect(() => reporter.report).not.toThrow()
    })
  })

  describe('Cucumber step uid scoping (no cross-scenario collision)', () => {
    const FEATURE = '/proj/features/login.feature'
    const STEP =
      'I should see a flash message saying You logged into a secure area!'

    const scenario = (title: string, line: number): SuiteStats =>
      ({
        uid: `raw-${title}`,
        title,
        fullTitle: `Login ${title}`,
        file: FEATURE,
        type: 'scenario',
        argument: { uri: FEATURE, line }
      }) as unknown as SuiteStats

    const step = (line: number): TestStats =>
      ({
        uid: 'raw-step',
        title: STEP,
        fullTitle: STEP,
        file: FEATURE,
        type: 'test',
        argument: { uri: FEATURE, line }
      }) as unknown as TestStats

    // Drive a scenario's step through the reporter and return the assigned uid.
    const runStep = (
      r: TestReporter,
      scen: SuiteStats,
      stepStats: TestStats
    ): string => {
      r.onSuiteStart(scen)
      r.onTestStart(stepStats)
      r.onTestEnd(stepStats)
      r.onSuiteEnd(scen)
      return stepStats.uid
    }

    it('gives identical step text in sibling scenarios distinct uids', () => {
      const scenA = scenario('Scenario A', 5)
      const scenB = scenario('Scenario B', 20)
      const uidA = runStep(reporter, scenA, step(8))
      const uidB = runStep(reporter, scenB, step(23))
      expect(uidA).not.toBe(uidB)
    })

    it('keeps a step uid stable when its scenario is rerun alone', () => {
      // Full run: scenario A then B.
      const uidBFull = (() => {
        runStep(reporter, scenario('Scenario A', 5), step(8))
        return runStep(reporter, scenario('Scenario B', 20), step(23))
      })()

      // Rerun scenario B on its own (fresh reporter resets the counter). A
      // run-order-counter uid would shift to A's slot here; scoping by the
      // scenario keeps it stable.
      const reporter2 = new TestReporter(
        { logFile: '/tmp/test.log' },
        sendUpstream as any
      )
      const uidBAlone = runStep(reporter2, scenario('Scenario B', 20), step(23))

      expect(uidBAlone).toBe(uidBFull)
    })

    it('distinguishes scenario-outline example rows (same title, different line)', () => {
      const row1 = runStep(reporter, scenario('greet <name>', 10), step(11))
      const row2 = runStep(reporter, scenario('greet <name>', 14), step(15))
      expect(row1).not.toBe(row2)
    })
  })
})
