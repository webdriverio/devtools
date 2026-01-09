import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { RunnerRequestBody } from '../src/types.js'

vi.mock('node:child_process')
vi.mock('tree-kill')
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn()
  }
}))

// Mock the module resolution to prevent resolveWdioBin from failing during import
vi.mock('node:module', () => ({
  createRequire: () => ({
    resolve: () => '/mock/wdio/cli/index.js'
  })
}))

// Now import after mocks are set up
const { testRunner } = await import('../src/runner.js')

describe('TestRunner', () => {
  const mockConfigPath = '/test/wdio.conf.ts'
  const mockSpecFile = '/test/specs/test.spec.ts'
  const mockChild = {
    once: vi.fn((event: string, callback: (err?: Error) => void) => {
      if (event === 'spawn') {
        setTimeout(() => callback(), 0)
      }
    }),
    pid: 12345
  } as any

  const createMockChild = (spawnCallback = true, errorCallback = false) =>
    ({
      once: vi.fn((event, callback) => {
        if (event === 'spawn' && spawnCallback) {
          callback()
        }
        if (event === 'error' && errorCallback) {
          callback(new Error('Spawn failed'))
        }
      }),
      pid: 12345
    }) as any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    process.env.DEVTOOLS_RUNNER_CWD = ''
    process.env.DEVTOOLS_WDIO_CONFIG = ''
    process.env.DEVTOOLS_WDIO_BIN = ''
  })

  afterEach(() => {
    testRunner.stop()
  })

  describe('framework filters', () => {
    beforeEach(() => {
      vi.mocked(spawn).mockReturnValue(mockChild)
    })

    it('should apply correct filters for cucumber, mocha, and jasmine frameworks', async () => {
      const frameworks = [
        { name: 'cucumber', flag: '--cucumberOpts.name' },
        { name: 'mocha', flag: '--mochaOpts.grep' },
        { name: 'jasmine', flag: '--jasmineOpts.grep' }
      ]

      for (let i = 0; i < frameworks.length; i++) {
        const { name, flag } = frameworks[i]
        await testRunner.run({
          uid: `test-${i + 1}`,
          entryType: 'test',
          framework: name as any,
          fullTitle: `${name} test`,
          specFile: mockSpecFile,
          configFile: mockConfigPath
        })
        expect(vi.mocked(spawn).mock.calls[i][1]).toEqual(
          expect.arrayContaining([flag])
        )
        testRunner.stop()
      }
    })
  })

  describe('run and stop', () => {
    it('should prevent concurrent runs and handle environment variables', async () => {
      vi.mocked(spawn).mockReturnValue(mockChild)
      const payload: RunnerRequestBody = {
        uid: 'test-1',
        entryType: 'test',
        configFile: mockConfigPath,
        devtoolsHost: 'localhost',
        devtoolsPort: 3000
      }

      const firstRun = testRunner.run(payload)
      await new Promise((resolve) => setTimeout(resolve, 10))

      await expect(testRunner.run(payload)).rejects.toThrow(
        'A test run is already in progress'
      )

      const env = vi.mocked(spawn).mock.calls[0][2]?.env as Record<
        string,
        string
      >
      expect(env.DEVTOOLS_APP_HOST).toBe('localhost')
      expect(env.DEVTOOLS_APP_PORT).toBe('3000')
      expect(env.DEVTOOLS_APP_REUSE).toBe('1')

      testRunner.stop()
      await firstRun.catch(() => {})
    })

    it('should handle spawn errors', async () => {
      const errorChild = createMockChild(false, true)
      vi.mocked(spawn).mockReturnValue(errorChild)

      await expect(
        testRunner.run({
          uid: 'test-1',
          entryType: 'test',
          configFile: mockConfigPath
        })
      ).rejects.toThrow('Spawn failed')
    })
  })

  describe('configuration', () => {
    it('should find config and use environment variables', async () => {
      const specFile = '/project/test/specs/test.spec.ts'
      const configInTestDir = '/project/test/wdio.conf.ts'
      const envConfig = '/custom/wdio.conf.ts'

      const mockChild = {
        once: vi.fn((event, callback) => {
          if (event === 'spawn') {
            callback()
          }
        }),
        pid: 12345
      } as any

      vi.mocked(spawn).mockReturnValue(mockChild)

      // Test with spec file location
      vi.mocked(fs.existsSync).mockImplementation(
        (path) => path === configInTestDir
      )
      await testRunner.run({ uid: 'test-1', entryType: 'test', specFile })
      expect(vi.mocked(spawn).mock.calls[0][1]).toContain(configInTestDir)
      testRunner.stop()

      // Test with env variable
      process.env.DEVTOOLS_WDIO_CONFIG = envConfig
      vi.mocked(fs.existsSync).mockImplementation((path) => path === envConfig)
      await testRunner.run({ uid: 'test-2', entryType: 'test' })
      expect(vi.mocked(spawn).mock.calls[1][1]).toContain(envConfig)
      testRunner.stop()
    })

    it('should throw error if config cannot be found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const payload: RunnerRequestBody = {
        uid: 'test-1',
        entryType: 'test'
      }

      const mockChild = {
        once: vi.fn(),
        pid: 12345
      } as any

      vi.mocked(spawn).mockReturnValue(mockChild)

      await expect(testRunner.run(payload)).rejects.toThrow(
        'Cannot locate WDIO config'
      )
    })
  })

  describe('spec file normalization', () => {
    it('should handle file:// URLs', async () => {
      const payload: RunnerRequestBody = {
        uid: 'test-1',
        entryType: 'test',
        specFile: 'file:///project/test.spec.ts',
        configFile: mockConfigPath
      }

      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run(payload)

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args.some((arg) => arg.includes('/project/test.spec.ts'))).toBe(
        true
      )
    })

    it('should extract spec from callSource', async () => {
      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run({
        uid: 'test-1',
        entryType: 'test',
        callSource: '/project/test.spec.ts:10:5',
        configFile: mockConfigPath
      })
      expect(spawn).toHaveBeenCalled()
    })

    it('should resolve relative paths', async () => {
      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run({
        uid: 'test-1',
        entryType: 'test',
        specFile: 'test/test.spec.ts',
        configFile: mockConfigPath
      })

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(
        args.some((arg) => arg.startsWith('/') || path.isAbsolute(arg))
      ).toBe(true)
    })
  })

  describe('line number resolution', () => {
    it('should use lineNumber from payload', async () => {
      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run({
        uid: 'test-1',
        entryType: 'test',
        specFile: mockSpecFile,
        lineNumber: 42,
        configFile: mockConfigPath
      })

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args.some((arg) => arg.includes(':42'))).toBe(true)
    })

    it('should extract line number from callSource', async () => {
      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run({
        uid: 'test-1',
        entryType: 'test',
        specFile: mockSpecFile,
        callSource: '/project/test.spec.ts:25:10',
        configFile: mockConfigPath
      })

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args.some((arg) => arg.includes(':25'))).toBe(true)
    })
  })

  describe('runAll mode', () => {
    it('should not use spec filter when runAll is true', async () => {
      vi.mocked(spawn).mockReturnValue(createMockChild())
      await testRunner.run({
        uid: 'run-all',
        entryType: 'suite',
        runAll: true,
        configFile: mockConfigPath
      })

      const args = vi.mocked(spawn).mock.calls[0][1] as string[]
      expect(args).not.toContain('--spec')
    })
  })
})
