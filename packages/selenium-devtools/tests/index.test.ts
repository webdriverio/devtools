import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as net from 'node:net'

import {
  stripAnsiCodes,
  detectLogLevel,
  createConsoleLogEntry,
  chromeLogLevelToLogLevel,
  generateStableUid,
  deterministicUid,
  resetSignatureCounters,
  getCallSourceFromStack,
  findTestLineInFile,
  isPortInUse,
  findFreePort,
  getRequestType,
  captureLaunchCommand
} from '../src/helpers/utils.js'
import { SessionCapturer } from '../src/session.js'
import {
  patchSelenium,
  getDriverOriginals,
  getElementOriginals
} from '../src/driverPatcher.js'
import { RerunManager } from '../src/rerunManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestManager } from '../src/helpers/testManager.js'
import { TestReporter } from '../src/reporter.js'
import { LOG_SOURCES, PATCHED_SYMBOL, DEFAULTS } from '../src/constants.js'
import type { CapturedCommand, SuiteStats, TestStats } from '../src/types.js'

// ───── helpers/utils ────────────────────────────────────────────────────────

describe('helpers/utils', () => {
  it('stripAnsiCodes removes color escape sequences', () => {
    expect(stripAnsiCodes('\x1b[31mred\x1b[0m')).toBe('red')
    expect(stripAnsiCodes('plain')).toBe('plain')
  })

  it('detectLogLevel matches keyword patterns, falling back to "log"', () => {
    expect(detectLogLevel('INFO: hello')).toBe('info')
    expect(detectLogLevel('warning: things')).toBe('warn')
    expect(detectLogLevel('ERROR boom')).toBe('error')
    expect(detectLogLevel('debug spew')).toBe('debug')
    expect(detectLogLevel('trace it')).toBe('trace')
    expect(detectLogLevel('plain message')).toBe('log')
    expect(detectLogLevel('\x1b[31mERROR\x1b[0m: ansi')).toBe('error')
  })

  it('createConsoleLogEntry stamps timestamp, type, args, and source', () => {
    const before = Date.now()
    const entry = createConsoleLogEntry('info', ['hello'])
    expect(entry.type).toBe('info')
    expect(entry.args).toEqual(['hello'])
    expect(entry.source).toBe(LOG_SOURCES.TEST)
    expect(entry.timestamp).toBeGreaterThanOrEqual(before)

    const browser = createConsoleLogEntry('log', ['x'], LOG_SOURCES.BROWSER)
    expect(browser.source).toBe(LOG_SOURCES.BROWSER)
  })

  it('chromeLogLevelToLogLevel maps WebDriver log levels to our levels', () => {
    expect(chromeLogLevelToLogLevel('SEVERE')).toBe('error')
    expect(chromeLogLevelToLogLevel('WARNING')).toBe('warn')
    expect(chromeLogLevelToLogLevel('INFO')).toBe('info')
    expect(chromeLogLevelToLogLevel('DEBUG')).toBe('debug')
    expect(chromeLogLevelToLogLevel('ANYTHING')).toBe('log')
    expect(chromeLogLevelToLogLevel({ name: 'severe' })).toBe('error')
    expect(chromeLogLevelToLogLevel({})).toBe('log')
  })

  it('generateStableUid is deterministic with counter-based disambiguation', () => {
    resetSignatureCounters()
    const a = generateStableUid('/spec.ts', 'same')
    const b = generateStableUid('/spec.ts', 'same')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^stable-[0-9a-z]+$/)

    resetSignatureCounters()
    expect(generateStableUid('/spec.ts', 'same')).toBe(a)
  })

  it('deterministicUid yields identical output for identical parts', () => {
    expect(deterministicUid('a', 'b')).toBe(deterministicUid('a', 'b'))
    expect(deterministicUid('a', 'b')).not.toBe(deterministicUid('a', 'c'))
  })

  it('getCallSourceFromStack reports a user-code frame', () => {
    const { filePath, callSource } = getCallSourceFromStack()
    expect(callSource).toMatch(/:\d+$/)
    if (filePath) {
      expect(filePath).not.toContain('/node_modules/')
      expect(filePath).not.toContain('/dist/')
    }
  })

  describe('findTestLineInFile', () => {
    const tmpFiles: string[] = []
    const writeTmp = (contents: string) => {
      const p = path.join(
        os.tmpdir(),
        `selenium-devtools-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`
      )
      fs.writeFileSync(p, contents)
      tmpFiles.push(p)
      return p
    }
    afterEach(() => {
      while (tmpFiles.length) {
        try {
          fs.unlinkSync(tmpFiles.pop()!)
        } catch {
          /* ignore */
        }
      }
    })

    it('locates it() and describe() blocks; safely handles misses and regex chars', () => {
      const itFile = writeTmp(
        [
          "describe('outer', () => {",
          "  it('does the thing', () => {})",
          '})'
        ].join('\n')
      )
      expect(findTestLineInFile(itFile, 'does the thing')).toBe(2)
      expect(findTestLineInFile(itFile, 'outer', 'suite')).toBe(1)
      expect(findTestLineInFile(itFile, 'not here')).toBeNull()

      const metaFile = writeTmp("it('a (b) [c]', () => {})")
      expect(findTestLineInFile(metaFile, 'a (b) [c]')).toBe(1)

      expect(
        findTestLineInFile(
          path.join(os.tmpdir(), `missing-${Date.now()}.ts`),
          'anything'
        )
      ).toBeNull()
    })
  })

  it('isPortInUse / findFreePort detect busy and free ports', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const busy = (server.address() as net.AddressInfo).port

    expect(await isPortInUse(busy, '127.0.0.1')).toBe(true)
    expect(await findFreePort(busy, '127.0.0.1')).toBeGreaterThan(busy)

    await new Promise<void>((r) => server.close(() => r()))
    expect(await isPortInUse(busy, '127.0.0.1')).toBe(false)
  })

  it('getRequestType maps MIME types and URL extensions to request kinds', () => {
    expect(getRequestType('/x', 'text/html')).toBe('document')
    expect(getRequestType('/x', 'text/css')).toBe('stylesheet')
    expect(getRequestType('/x', 'application/javascript')).toBe('script')
    expect(getRequestType('/x', 'image/png')).toBe('image')
    expect(getRequestType('/x', 'font/woff2')).toBe('font')
    expect(getRequestType('/x', 'application/json')).toBe('fetch')

    expect(getRequestType('/a.html')).toBe('document')
    expect(getRequestType('/a.css')).toBe('stylesheet')
    expect(getRequestType('/a.mjs')).toBe('script')
    expect(getRequestType('/a.PNG')).toBe('image')
    expect(getRequestType('/a.woff2')).toBe('font')
    expect(getRequestType('/api/data')).toBe('xhr')
  })

  it('captureLaunchCommand prefers npm/yarn/pnpm scripts, falls back to argv', () => {
    const env = { ...process.env }
    try {
      process.env.npm_lifecycle_event = 'test'
      process.env.npm_config_user_agent = 'npm/10.0.0'
      expect(captureLaunchCommand()).toBe('npm run test')

      process.env.npm_config_user_agent = 'pnpm/9.0.0'
      expect(captureLaunchCommand()).toBe('pnpm test')

      process.env.npm_config_user_agent = 'yarn/1.22.0'
      expect(captureLaunchCommand()).toBe('yarn test')

      delete process.env.npm_lifecycle_event
      expect(captureLaunchCommand()).toContain(process.argv0)
    } finally {
      process.env = env
    }
  })
})

// ───── SessionCapturer ──────────────────────────────────────────────────────

describe('SessionCapturer', () => {
  it('initializes with empty buffers and is not reporting upstream', () => {
    const capturer = new SessionCapturer()
    try {
      expect(capturer.commandsLog).toEqual([])
      expect(capturer.consoleLogs).toEqual([])
      expect(capturer.networkRequests).toEqual([])
      expect(capturer.mutations).toEqual([])
      expect(capturer.isReportingUpstream).toBe(false)
      expect(capturer.isConnected()).toBe(false)
    } finally {
      capturer.cleanup()
    }
  })

  it('captureCommand stores entries with monotonic ids and serializes errors', async () => {
    const capturer = new SessionCapturer()
    try {
      const a = await capturer.captureCommand(
        'click',
        ['.btn'],
        'ok',
        undefined
      )
      const b = await capturer.captureCommand(
        'getText',
        ['.x'],
        'hi',
        new Error('boom')
      )
      expect(capturer.commandsLog).toHaveLength(2)
      expect(a._id).toBe(0)
      expect(b._id).toBe(1)
      expect(a.command).toBe('click')
      expect(b.error).toMatchObject({ name: 'Error', message: 'boom' })
      expect(b.error?.stack).toBeDefined()
    } finally {
      capturer.cleanup()
    }
  })

  it('replaceCommand updates in place; appends a new one when id is unknown', async () => {
    const capturer = new SessionCapturer()
    try {
      const first = await capturer.captureCommand('click', [], 'a', undefined)
      await capturer.captureCommand('getText', [], 'b', undefined)

      const replaced = capturer.replaceCommand(
        first._id!,
        'click',
        ['.btn'],
        'updated',
        undefined
      )
      expect(capturer.commandsLog).toHaveLength(2)
      expect(capturer.commandsLog[0].result).toBe('updated')
      expect(capturer.commandsLog[0].args).toEqual(['.btn'])
      expect(replaced.oldTimestamp).toBeGreaterThan(0)

      const fresh = capturer.replaceCommand(
        999,
        'new',
        [],
        undefined,
        undefined
      )
      expect(capturer.commandsLog).toHaveLength(3)
      expect(fresh.oldTimestamp).toBe(0)
      expect(fresh.entry.command).toBe('new')
    } finally {
      capturer.cleanup()
    }
  })

  it('captures all four console methods, serializes objects, drops internal lines, and restores on cleanup', () => {
    const originalLog = console.log
    const capturer = new SessionCapturer()
    expect(console.log).not.toBe(originalLog)

    const start = capturer.consoleLogs.length
    console.log('msg')
    console.info('info-msg')
    console.warn('warn-msg')
    console.error('err-msg')
    console.log('payload', { id: 1, nested: { x: 2 } })
    console.log('{"level":30,"msg":"pino"}') // dropped — internal stream line
    console.log('[SESSION] internal marker') // dropped — internal stream line

    const captured = capturer.consoleLogs.slice(start)
    expect(captured.map((e) => e.type)).toEqual([
      'log',
      'info',
      'warn',
      'error',
      'log'
    ])
    expect(captured.every((e) => e.source === LOG_SOURCES.TEST)).toBe(true)
    expect(captured[4].args).toEqual(['payload', '{"id":1,"nested":{"x":2}}'])

    capturer.cleanup()
    expect(console.log).toBe(originalLog)
  })

  it('intercepts process.stdout/stderr writes as terminal logs and stops on cleanup', () => {
    const capturer = new SessionCapturer()
    const startLen = capturer.consoleLogs.length

    process.stdout.write('INFO: from stdout\n')
    process.stderr.write('ERROR: from stderr\n')

    const terminalLogs = capturer.consoleLogs
      .slice(startLen)
      .filter((e) => e.source === LOG_SOURCES.TERMINAL)
    expect(terminalLogs.length).toBeGreaterThanOrEqual(2)

    const afterCapture = capturer.consoleLogs.length
    capturer.cleanup()
    process.stdout.write('post-cleanup\n')
    expect(capturer.consoleLogs).toHaveLength(afterCapture)
  })

  it('captureSource reads files once and deduplicates; missing files are tolerated', async () => {
    const tmp = path.join(os.tmpdir(), `selenium-source-${Date.now()}.ts`)
    fs.writeFileSync(tmp, 'const x = 1')
    const capturer = new SessionCapturer()
    try {
      await capturer.captureSource(tmp)
      await capturer.captureSource(tmp)
      expect(capturer.sources.get(tmp)).toBe('const x = 1')
      expect(capturer.sources.size).toBe(1)

      await capturer.captureSource(
        path.join(os.tmpdir(), `nope-${Date.now()}.ts`)
      )
      expect(capturer.sources.size).toBe(1)
    } finally {
      fs.unlinkSync(tmp)
      capturer.cleanup()
    }
  })

  it('isNavigationCommand recognises selenium navigation method names', () => {
    const capturer = new SessionCapturer()
    try {
      for (const cmd of [
        'get',
        'navigate',
        'to',
        'back',
        'forward',
        'refresh'
      ]) {
        expect(capturer.isNavigationCommand(cmd)).toBe(true)
      }
      for (const cmd of ['click', 'sendKeys', 'isDisplayed']) {
        expect(capturer.isNavigationCommand(cmd)).toBe(false)
      }
    } finally {
      capturer.cleanup()
    }
  })

  it('sendUpstream silently drops messages when no WebSocket is configured', () => {
    const capturer = new SessionCapturer()
    try {
      capturer.sendUpstream('metadata', { url: 'http://x' })
      expect(capturer.isReportingUpstream).toBe(false)
      // The drop must be silent: no buffered state, no entries in any
      // capture array, no thrown error.
      expect(capturer.consoleLogs).toEqual([])
      expect(capturer.commandsLog).toEqual([])
      expect(capturer.metadata).toBeUndefined()
    } finally {
      capturer.cleanup()
    }
  })

  it('takeScreenshot returns null when no driver is bound', async () => {
    const capturer = new SessionCapturer()
    try {
      expect(await capturer.takeScreenshot()).toBeNull()
    } finally {
      capturer.cleanup()
    }
  })
})

// ───── driverPatcher ────────────────────────────────────────────────────────

describe('driverPatcher', () => {
  const require = createRequire(import.meta.url)
  const sw = require('selenium-webdriver')
  const driverProto = sw.WebDriver.prototype
  const elementProto = sw.WebElement?.prototype
  const builderProto = sw.Builder.prototype

  // patchSelenium mutates the WebDriver/Builder prototypes in place. Stash
  // the unwrapped methods at module load and reinstall them before each test
  // so successive patches actually wrap again.
  const stash = {
    driverFns: {} as Record<string, any>,
    elementFns: {} as Record<string, any>,
    builderBuild: builderProto.build,
    driverQuit: driverProto.quit
  }
  for (const name of Object.getOwnPropertyNames(driverProto)) {
    const desc = Object.getOwnPropertyDescriptor(driverProto, name)
    if (desc && typeof desc.value === 'function') {
      stash.driverFns[name] = desc.value
    }
  }
  if (elementProto) {
    for (const name of Object.getOwnPropertyNames(elementProto)) {
      const desc = Object.getOwnPropertyDescriptor(elementProto, name)
      if (desc && typeof desc.value === 'function') {
        stash.elementFns[name] = desc.value
      }
    }
  }

  function resetPatchState() {
    delete (driverProto as any)[PATCHED_SYMBOL]
    if (elementProto) {
      delete (elementProto as any)[PATCHED_SYMBOL]
    }
    delete (builderProto as any)[PATCHED_SYMBOL]
    for (const [name, fn] of Object.entries(stash.driverFns)) {
      ;(driverProto as any)[name] = fn
    }
    if (elementProto) {
      for (const [name, fn] of Object.entries(stash.elementFns)) {
        ;(elementProto as any)[name] = fn
      }
    }
    builderProto.build = stash.builderBuild
    driverProto.quit = stash.driverQuit
  }

  beforeEach(() => resetPatchState())

  it('patches prototypes idempotently and populates the originals registry', () => {
    const hooks = { onDriverCreated: vi.fn(), onCommand: vi.fn() }
    expect(patchSelenium(hooks)).toBe(true)
    expect((driverProto as any)[PATCHED_SYMBOL]).toBe(true)
    expect((builderProto as any)[PATCHED_SYMBOL]).toBe(true)

    const wrappedBuild = builderProto.build
    patchSelenium(hooks)
    expect(builderProto.build).toBe(wrappedBuild)

    const originals = getDriverOriginals()
    expect(typeof originals.takeScreenshot).toBe('function')
    expect(typeof originals.executeScript).toBe('function')
    expect(typeof originals.manage).toBe('function')
    const elOriginals = getElementOriginals()
    expect(typeof elOriginals.getText).toBe('function')
    expect(typeof elOriginals.getTagName).toBe('function')

    // Internal methods stay pristine — never reach onCommand.
    for (const m of ['execute', 'manage', 'switchTo', 'getSession']) {
      const fn = (driverProto as any)[m]
      if (typeof fn === 'function') {
        expect(fn).toBe(stash.driverFns[m])
      }
    }
  })

  it('captures sync, async, and throwing wrapper invocations through onCommand', async () => {
    const onCommand = vi.fn<(cmd: CapturedCommand) => void>()
    ;(driverProto as any).testSync = function (n: number) {
      return n * 2
    }
    ;(driverProto as any).testAsync = function () {
      return Promise.resolve('async-result')
    }
    ;(driverProto as any).testThrow = function () {
      throw new Error('sync boom')
    }
    stash.driverFns.testSync = (driverProto as any).testSync
    stash.driverFns.testAsync = (driverProto as any).testAsync
    stash.driverFns.testThrow = (driverProto as any).testThrow

    patchSelenium({ onDriverCreated: vi.fn(), onCommand })
    const fakeDriver = Object.create(driverProto)

    expect((fakeDriver as any).testSync(5)).toBe(10)
    let last = onCommand.mock.calls.at(-1)![0]
    expect(last).toMatchObject({
      command: 'testSync',
      args: [5],
      result: 10,
      fromElement: false
    })

    const asyncResult = await (fakeDriver as any).testAsync()
    await new Promise((r) => setImmediate(r))
    expect(asyncResult).toBe('async-result')
    last = onCommand.mock.calls.at(-1)![0]
    expect(last.result).toBe('async-result')
    expect(last.error).toBeUndefined()

    expect(() => (fakeDriver as any).testThrow()).toThrow('sync boom')
    last = onCommand.mock.calls.at(-1)![0]
    expect(last.error?.message).toBe('sync boom')
    expect(last.result).toBeUndefined()

    for (const m of ['testSync', 'testAsync', 'testThrow']) {
      delete (driverProto as any)[m]
      delete stash.driverFns[m]
    }
  })

  it('runs onBeforeQuit before original quit, and onBeforeBuild/onDriverCreated around build', async () => {
    const order: string[] = []

    const originalQuit = vi.fn(async () => {
      order.push('original-quit')
    })
    ;(driverProto as any).quit = originalQuit
    stash.driverQuit = originalQuit

    const fakeDriverObj = { __fake: true }
    builderProto.build = vi.fn(function () {
      order.push('original-build')
      return fakeDriverObj
    }) as any
    stash.builderBuild = builderProto.build

    const onDriverCreated = vi.fn(() => order.push('created'))
    patchSelenium({
      onBeforeBuild: vi.fn(() => order.push('before-build')),
      onDriverCreated,
      onCommand: vi.fn(),
      onBeforeQuit: vi.fn(async () => {
        order.push('before-quit')
      })
    })

    const builder = Object.create(builderProto)
    const result = builderProto.build.call(builder)
    expect(result).toBe(fakeDriverObj)
    expect(onDriverCreated).toHaveBeenCalledWith(fakeDriverObj)

    const fakeDriver = Object.create(driverProto)
    await (fakeDriver as any).quit()

    expect(order).toEqual([
      'before-build',
      'original-build',
      'created',
      'before-quit',
      'original-quit'
    ])
  })
})

// ───── RerunManager ─────────────────────────────────────────────────────────

describe('RerunManager', () => {
  const originalEnv = { ...process.env }
  const originalArgv = [...process.argv]

  beforeEach(() => {
    process.env = { ...originalEnv }
  })
  afterEach(() => {
    process.env = { ...originalEnv }
    process.argv = [...originalArgv]
  })

  it('launchCommand surfaces the npm script the user ran', () => {
    process.env.npm_lifecycle_event = 'example:mocha'
    process.env.npm_config_user_agent = 'npm/10.0.0'
    expect(new RerunManager('mocha').launchCommand).toBe(
      'npm run example:mocha'
    )
  })

  it('rerunTemplate uses the correct filter flag per runner and returns undefined for unknown ones', () => {
    process.argv = ['node', '/path/to/test.js']
    expect(new RerunManager('mocha').rerunTemplate).toContain(
      '--grep "{{testName}}"'
    )
    expect(new RerunManager('jest').rerunTemplate).toContain(
      '--testNamePattern "{{testName}}"'
    )
    expect(new RerunManager('vitest').rerunTemplate).toContain(
      '-t "{{testName}}"'
    )
    expect(new RerunManager('cucumber').rerunTemplate).toContain(
      '--name "{{testName}}"'
    )
    expect(new RerunManager('jasmine').rerunTemplate).toBeUndefined()
  })

  it('rerunTemplate returns the user-supplied override verbatim', () => {
    const mgr = new RerunManager('mocha')
    mgr.configure('npm test -- --grep "{{testName}}"')
    expect(mgr.rerunTemplate).toBe('npm test -- --grep "{{testName}}"')
  })

  it('rerunTemplate strips inherited filter flags so reruns do not stack', () => {
    process.argv = [
      'node',
      '/path/to/jest.js',
      '--testNamePattern',
      'old',
      '-t',
      'stale',
      '--testNamePattern=also-stale',
      'spec.test.ts'
    ]
    const tpl = new RerunManager('jest').rerunTemplate!
    expect(tpl).not.toContain('old')
    expect(tpl).not.toContain('stale')
    expect(tpl).not.toContain('also-stale')
    expect(tpl).toContain('--testNamePattern "{{testName}}"')
  })

  it('rerunTemplate shell-quotes paths with spaces and escapes embedded single quotes', () => {
    process.argv = ['node', '/path with spaces/test runner.js', "/weird'path"]
    const tpl = new RerunManager('mocha').rerunTemplate!
    expect(tpl).toContain("'/path with spaces/test runner.js'")
    expect(tpl).toContain("'\\''")
  })
})

// ───── SuiteManager / TestManager / TestReporter ────────────────────────────

function makeSuite(overrides: Partial<SuiteStats> = {}): SuiteStats {
  return {
    uid: 'suite-1',
    cid: '0-0',
    title: 'Suite',
    fullTitle: 'Suite',
    file: '/tmp/spec.ts',
    type: 'suite',
    start: new Date(),
    state: 'running',
    end: null,
    tests: [],
    suites: [],
    hooks: [],
    _duration: 0,
    ...overrides
  }
}

function makeTest(overrides: Partial<TestStats> = {}): TestStats {
  return {
    uid: 'test-1',
    cid: '0-0',
    title: 'a test',
    fullTitle: 'Suite > a test',
    parent: 'suite-1',
    state: 'running',
    start: new Date(),
    end: null,
    type: 'test',
    file: '/tmp/spec.ts',
    retries: 0,
    _duration: 0,
    hooks: [],
    ...overrides
  }
}

describe('TestReporter', () => {
  it('emits the suite payload on registration and deduplicates by uid', () => {
    const report = vi.fn()
    const reporter = new TestReporter(report)
    const suite = makeSuite()

    reporter.onSuiteStart(suite)
    reporter.onSuiteStart(suite)
    expect(reporter.report).toHaveLength(1)
    expect(report).toHaveBeenCalled()
    expect(report.mock.calls[0][0]).toEqual([{ 'suite-1': suite }])
  })

  it('onTestStart/onTestEnd replace the matching entry inside its parent suite', () => {
    const reporter = new TestReporter(vi.fn())
    const suite = makeSuite({ tests: [makeTest({ state: 'pending' })] })
    reporter.onSuiteStart(suite)

    reporter.onTestStart(makeTest({ state: 'running' }))
    expect((suite.tests[0] as TestStats).state).toBe('running')

    reporter.onTestEnd(makeTest({ state: 'passed' }))
    expect((suite.tests[0] as TestStats).state).toBe('passed')
  })

  it('clearExecutionData empties allSuites; updateUpstream swaps the sink; updateSuites with no suites is a no-op', () => {
    const report = vi.fn()
    const reporter = new TestReporter(report)
    reporter.onSuiteStart(makeSuite())
    expect(reporter.report).toHaveLength(1)

    reporter.clearExecutionData()
    expect(reporter.report).toEqual([])

    report.mockClear()
    reporter.updateSuites()
    expect(report).not.toHaveBeenCalled()

    const next = vi.fn()
    reporter.updateUpstream(next)
    reporter.onSuiteStart(makeSuite({ uid: 'suite-2' }))
    expect(next).toHaveBeenCalled()
  })
})

describe('SuiteManager', () => {
  function setup() {
    const report = vi.fn()
    const reporter = new TestReporter(report)
    const mgr = new SuiteManager(reporter)
    return { mgr, reporter, report }
  }

  it('creates the root suite once and reuses it; getCurrentParent follows the open scenario sub-suite', () => {
    const { mgr } = setup()
    const root = mgr.getOrCreateRootSuite('/spec.ts', 'Suite')
    expect(mgr.getOrCreateRootSuite('/spec.ts', 'Suite')).toBe(root)
    expect(mgr.getCurrentParent()).toBe(root)

    const scenario = mgr.startScenarioSuite('Scenario', '/spec.ts')!
    expect(scenario.parent).toBe(root.uid)
    expect(root.suites).toContain(scenario)
    expect(mgr.getCurrentParent()).toBe(scenario)

    mgr.endScenarioSuite('passed')
    expect(scenario.state).toBe('passed')
    expect(scenario.end).not.toBeNull()
    expect(mgr.getCurrentParent()).toBe(root)
  })

  it('startScenarioSuite returns null without a root; endScenarioSuite is a no-op without a scenario', () => {
    const { mgr } = setup()
    expect(mgr.startScenarioSuite('orphan', '/x.ts')).toBeNull()
    const root = mgr.getOrCreateRootSuite('/spec.ts', 'Suite')
    // endScenarioSuite when no scenario is open must NOT mark the root as
    // ended — the root is still the currentParent and is logically open.
    mgr.endScenarioSuite('passed')
    expect(root.end).toBeNull()
    expect(root.state).toBe('running')
    expect(mgr.getCurrentParent()).toBe(root)
  })

  it('setRootSuiteTitle only emits when something actually changed', () => {
    const { mgr, report } = setup()
    const root = mgr.getOrCreateRootSuite('/spec.ts', 'Old')
    report.mockClear()
    mgr.setRootSuiteTitle('New', '/spec.ts:42')
    expect(root.title).toBe('New')
    expect(root.callSource).toBe('/spec.ts:42')
    expect(report).toHaveBeenCalled()

    report.mockClear()
    mgr.setRootSuiteTitle('New', '/spec.ts:42')
    expect(report).not.toHaveBeenCalled()
  })

  it('finalize derives pass/fail from direct tests and from nested sub-suites', () => {
    const a = setup()
    const root = a.mgr.getOrCreateRootSuite('/spec.ts', 'Suite')
    a.mgr.addTest({ ...makeTest({ uid: 't1' }), state: 'passed' })
    a.mgr.addTest({ ...makeTest({ uid: 't2' }), state: 'passed' })
    a.mgr.finalize()
    expect(root.state).toBe('passed')

    const b = setup()
    const root2 = b.mgr.getOrCreateRootSuite('/spec.ts', 'Suite2')
    b.mgr.addTest({ ...makeTest({ uid: 't1' }), state: 'failed' })
    b.mgr.finalize()
    expect(root2.state).toBe('failed')

    const c = setup()
    const root3 = c.mgr.getOrCreateRootSuite('/spec.ts', 'Feature')
    c.mgr.startScenarioSuite('S', '/spec.ts')
    c.mgr.endScenarioSuite('failed')
    c.mgr.finalize()
    expect(root3.state).toBe('failed')
  })

  it('reset clears rootSuite and currentParent', () => {
    const { mgr } = setup()
    mgr.getOrCreateRootSuite('/spec.ts', 'Suite')
    mgr.reset()
    expect(mgr.getRootSuite()).toBeNull()
    expect(mgr.getCurrentParent()).toBeNull()
  })
})

describe('TestManager', () => {
  function setup() {
    resetSignatureCounters()
    const reporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(reporter)
    const rootSuite = suiteManager.getOrCreateRootSuite('/spec.ts', 'Suite')
    const mgr = new TestManager(rootSuite, reporter, suiteManager)
    return { mgr, suiteManager, reporter, rootSuite }
  }

  it('session mode lazily creates one synthetic test, reused on subsequent calls', () => {
    const { mgr } = setup()
    const t = mgr.getOrEnsureTest()!
    expect(t.title).toBe(DEFAULTS.SESSION_TITLE)
    expect(t.state).toBe('running')
    expect(mgr.getOrEnsureTest()).toBe(t)
    expect(mgr.ensureSessionTest()).toBe(t)
  })

  it('startMarkedTest replaces the synthetic test and auto-ends the previous marked test', () => {
    const { mgr, rootSuite } = setup()
    const synthetic = mgr.ensureSessionTest()
    expect(rootSuite.tests).toContain(synthetic)

    const first = mgr.startMarkedTest('first', { callSource: '/spec.ts:10' })
    expect(first.title).toBe('first')
    expect(first.callSource).toBe('/spec.ts:10')
    expect(rootSuite.tests).not.toContain(synthetic)
    expect(rootSuite.tests).toContain(first)

    const second = mgr.startMarkedTest('second')
    expect(first.state).toBe('passed')
    expect(first.end).not.toBeNull()
    expect(mgr.getCurrentTest()).toBe(second)
  })

  it('endCurrent stamps state/end/duration; orphan commands attach to the last marked test', () => {
    const { mgr } = setup()
    const t = mgr.startMarkedTest('one')
    mgr.endCurrent('failed')
    expect(t.state).toBe('failed')
    expect(t.end).not.toBeNull()
    expect(t._duration).toBeGreaterThanOrEqual(0)
    expect(mgr.getCurrentTest()).toBeNull()
    expect(mgr.getOrEnsureTest()).toBe(t)
  })

  it('finalizeSession passes a still-running test, preserves terminal states, and no-ops when idle', () => {
    const a = setup()
    const t1 = a.mgr.startMarkedTest('one')
    a.mgr.finalizeSession()
    expect(t1.state).toBe('passed')
    expect(t1.end).not.toBeNull()
    expect(a.mgr.getCurrentTest()).toBeNull()

    const b = setup()
    const t2 = b.mgr.startMarkedTest('one')
    t2.state = 'failed'
    b.mgr.finalizeSession()
    expect(t2.state).toBe('failed')
    expect(b.mgr.getCurrentTest()).toBeNull()

    // Idle finalize must not invent a synthetic test or mutate suite state.
    const c = setup()
    c.mgr.finalizeSession()
    expect(c.mgr.getCurrentTest()).toBeNull()
    expect(c.rootSuite.tests).toEqual([])
  })

  it('startMarkedTest attaches to the open scenario sub-suite when one is active', () => {
    const { mgr, suiteManager } = setup()
    const scenario = suiteManager.startScenarioSuite('Scenario', '/spec.ts')!
    const step = mgr.startMarkedTest('step 1')
    expect(step.parent).toBe(scenario.uid)
    expect(scenario.tests).toContain(step)
  })
})
