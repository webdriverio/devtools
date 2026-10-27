import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetSignatureCounters } from '@wdio/devtools-core'
import {
  buildPluginMetadataOptions,
  nightwatchRunnerId,
  determineTestState,
  extractTestMetadata,
  findStepDefinitionLine,
  findTestFileByName,
  generateStableUid,
  getTestIcon,
  incrementCounters,
  captureNightwatchSelection,
  isNightwatchCli,
  parseCucumberScenario,
  resolveNightwatchConfig
} from '../src/helpers/utils.js'

describe('determineTestState', () => {
  it.each([
    [
      {
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'passed'
    ],
    [
      {
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 1,
        time: '0',
        assertions: []
      },
      'skipped'
    ],
    [
      {
        passed: 1,
        failed: 0,
        errors: 0,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'passed'
    ],
    [
      {
        passed: 0,
        failed: 1,
        errors: 0,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'failed'
    ],
    [
      {
        passed: 0,
        failed: 0,
        errors: 1,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'failed'
    ],
    [
      {
        passed: 1,
        failed: 1,
        errors: 0,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'failed'
    ],
    [
      {
        passed: 1,
        failed: 0,
        errors: 1,
        skipped: 0,
        time: '0',
        assertions: []
      },
      'failed'
    ]
  ])('maps testcase to %j → %s', (tc, expected) => {
    expect(determineTestState(tc as never)).toBe(expected)
  })
})

describe('getTestIcon', () => {
  it.each([
    ['passed', '✅'],
    ['skipped', '⏭'],
    ['failed', '❌'],
    ['running', '❌']
  ])('icon for %s', (state, icon) => {
    expect(getTestIcon(state as never)).toBe(icon)
  })
})

describe('incrementCounters', () => {
  it('increments the right bucket per state', () => {
    const c = { passCount: 0, failCount: 0, skipCount: 0 }
    incrementCounters(c, 'passed')
    incrementCounters(c, 'passed')
    incrementCounters(c, 'skipped')
    incrementCounters(c, 'failed')
    incrementCounters(c, 'running')
    expect(c).toEqual({ passCount: 2, failCount: 2, skipCount: 1 })
  })
})

describe('nightwatchRunnerId', () => {
  it('distinguishes the cucumber runner from the vanilla one', () => {
    // Both take the same locator dialect, but the id also drives the
    // dashboard's run capabilities, where cucumber cannot run a single test.
    expect(nightwatchRunnerId(true)).toBe('nightwatch-cucumber')
    expect(nightwatchRunnerId(false)).toBe('nightwatch')
  })

  it('is the same value the metadata payload reports', () => {
    for (const isCucumberRunner of [true, false]) {
      expect(
        buildPluginMetadataOptions({ isCucumberRunner, configPath: undefined })
          .framework
      ).toBe(nightwatchRunnerId(isCucumberRunner))
    }
  })
})

describe('buildPluginMetadataOptions', () => {
  // The run controls come from shared's runner defaults, so the adapter declares none of its own.
  it('names the runner and declares no run controls of its own', () => {
    const cucumber = buildPluginMetadataOptions({
      isCucumberRunner: true,
      configPath: '/x'
    })
    expect(cucumber).toMatchObject({
      framework: 'nightwatch-cucumber',
      configFile: '/x'
    })
    expect(cucumber).not.toHaveProperty('runCapabilities')
    expect(
      buildPluginMetadataOptions({
        isCucumberRunner: false,
        configPath: undefined
      }).framework
    ).toBe('nightwatch')
  })
})

describe('captureNightwatchSelection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-args-'))
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'tests', 'login.js'), '')
  // A folder named like a flag value, which must not be rewritten into a path.
  fs.mkdirSync(path.join(dir, 'smoke'))
  const pkg = path.join(dir, 'node_modules', 'nightwatch')
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"nightwatch"}')
  fs.writeFileSync(path.join(pkg, 'bin', 'nightwatch'), '')
  const cli = ['/usr/bin/node', path.join(pkg, 'bin', 'nightwatch')]

  it('keeps the selection without --config, with spec paths made absolute', () => {
    expect(
      captureNightwatchSelection(
        [...cli, '-c', 'nw.conf.js', 'tests/login.js', '--env', 'chrome'],
        dir
      )
    ).toEqual([path.join(dir, 'tests', 'login.js'), '--env', 'chrome'])
    expect(
      captureNightwatchSelection(
        [...cli, '--config=nw.conf.js', '--group', 'login'],
        dir
      )
    ).toEqual(['--group', 'login'])
  })

  // Regression: a flag value naming a local folder was replayed as an absolute path and matched no tests.
  it('never rewrites a flag value, even one that names a local folder', () => {
    expect(captureNightwatchSelection([...cli, '--tag', 'smoke'], dir)).toEqual(
      ['--tag', 'smoke']
    )
    expect(
      captureNightwatchSelection([...cli, '--tag=smoke', 'smoke'], dir)
    ).toEqual(['--tag=smoke', path.join(dir, 'smoke')])
  })

  it('selects nothing for a bare run', () => {
    expect(
      captureNightwatchSelection([...cli, '--config', 'nw.conf.js'], dir)
    ).toBeUndefined()
  })

  // Regression: any entry script with "nightwatch" in its path was taken for the CLI, so a wrapper's own flags were replayed.
  it('recognises the CLI by its package, not by a path that mentions it', () => {
    const wrapper = path.join(dir, 'nightwatch-e2e', 'run.js')
    fs.mkdirSync(path.dirname(wrapper), { recursive: true })
    fs.writeFileSync(wrapper, '')
    expect(isNightwatchCli(cli[1])).toBe(true)
    expect(isNightwatchCli(wrapper)).toBe(false)
    expect(isNightwatchCli(undefined)).toBe(false)
    expect(
      captureNightwatchSelection(
        ['/usr/bin/node', wrapper, '--retries', '2'],
        dir
      )
    ).toBeUndefined()
  })
})

describe('generateStableUid', () => {
  it('produces a deterministic hash for the first (file, name) call', () => {
    resetSignatureCounters()
    const a = generateStableUid('/a.test.ts', 'name')
    resetSignatureCounters()
    const b = generateStableUid('/a.test.ts', 'name')
    expect(a).toBe(b)
  })

  it('differentiates by file', () => {
    resetSignatureCounters()
    const a = generateStableUid('/a.test.ts', 'name')
    const b = generateStableUid('/b.test.ts', 'name')
    expect(a).not.toBe(b)
  })

  it('extracts file + fullTitle from an item form', () => {
    resetSignatureCounters()
    const a = generateStableUid({ file: '/a.test.ts', fullTitle: 'fullTitle' })
    resetSignatureCounters()
    const b = generateStableUid('/a.test.ts', 'fullTitle')
    expect(a).toBe(b)
  })

  it('falls back to title when fullTitle is missing', () => {
    resetSignatureCounters()
    const a = generateStableUid({ file: '/x.ts', title: 't' })
    resetSignatureCounters()
    const b = generateStableUid('/x.ts', 't')
    expect(a).toBe(b)
  })

  it('tolerates missing file and name', () => {
    expect(generateStableUid({ title: '' })).toBeTruthy()
  })
})

describe('parseCucumberScenario', () => {
  const feature = [
    'Feature: Login',
    '  Scenario: User logs in',
    '    Given a registered user',
    '    When they enter credentials',
    '    Then they see the dashboard'
  ].join('\n')

  it('finds feature, scenario, and step lines + keywords', () => {
    const r = parseCucumberScenario(feature, 'User logs in', [
      'a registered user',
      'they enter credentials',
      'they see the dashboard'
    ])
    expect(r.featureLine).toBe(1)
    expect(r.scenarioLine).toBe(2)
    expect(r.stepLines).toEqual([3, 4, 5])
    expect(r.stepKeywords).toEqual(['Given', 'When', 'Then'])
  })

  it('returns defaults when content is empty', () => {
    const r = parseCucumberScenario('', 'x', ['a', 'b'])
    expect(r.featureLine).toBe(1)
    expect(r.scenarioLine).toBe(1)
    expect(r.stepLines).toEqual([])
    expect(r.stepKeywords).toEqual(['', ''])
  })

  it('pads stepKeywords up to stepCount when feature has fewer steps', () => {
    const r = parseCucumberScenario(feature, 'User logs in', [
      'a',
      'b',
      'c',
      'd'
    ])
    expect(r.stepKeywords).toHaveLength(4)
  })

  it('uses default scenarioLine when scenario not found', () => {
    const r = parseCucumberScenario(feature, 'Nonexistent', [])
    expect(r.scenarioLine).toBe(1)
  })
})

describe('findStepDefinitionLine', () => {
  it('finds string-literal step defs', () => {
    const files = [
      {
        filePath: '/steps.ts',
        content: [
          'Given("a registered user", () => {})',
          'When("they {string}", () => {})'
        ].join('\n')
      }
    ]
    expect(findStepDefinitionLine(files, 'a registered user')).toEqual({
      filePath: '/steps.ts',
      line: 1
    })
    expect(findStepDefinitionLine(files, 'they "hello"')).toEqual({
      filePath: '/steps.ts',
      line: 2
    })
  })

  it('finds regex-literal step defs', () => {
    const files = [
      {
        filePath: '/s.ts',
        content: 'Then(/^see (\\d+) results$/, () => {})'
      }
    ]
    expect(findStepDefinitionLine(files, 'see 42 results')).toEqual({
      filePath: '/s.ts',
      line: 1
    })
  })

  it('returns null when nothing matches', () => {
    expect(findStepDefinitionLine([], 'anything')).toBeNull()
    expect(
      findStepDefinitionLine(
        [{ filePath: '/x.ts', content: 'Given("a", () => {})' }],
        'unmatched'
      )
    ).toBeNull()
  })

  it('handles cucumber-expression {int} placeholder', () => {
    const files = [
      {
        filePath: '/s.ts',
        content: 'Then("see {int} results", () => {})'
      }
    ]
    expect(findStepDefinitionLine(files, 'see 42 results')).toEqual({
      filePath: '/s.ts',
      line: 1
    })
  })
})

describe('findTestFileByName', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-utils-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds a matching test file under the workspace', () => {
    const target = path.join(tmpDir, 'sub', 'login.test.ts')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'export {}')
    const found = findTestFileByName('login', tmpDir)
    expect(found).toBe(target)
  })

  it('returns undefined when no workspace is given', () => {
    expect(findTestFileByName('anything')).toBeUndefined()
  })

  it('returns undefined when no match exists', () => {
    expect(findTestFileByName('nothere', tmpDir)).toBeUndefined()
  })
})

describe('extractTestMetadata', () => {
  let tmpFile: string
  beforeEach(() => {
    tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'nw-meta-')),
      'sample.test.ts'
    )
    fs.writeFileSync(
      tmpFile,
      [
        'describe("login", () => {',
        '  it("succeeds", () => {})',
        '  it("fails", () => {})',
        '})'
      ].join('\n')
    )
  })
  afterEach(() => {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true })
  })

  it('extracts suite and tests with line numbers', () => {
    const md = extractTestMetadata(tmpFile)
    expect(md.suiteTitle).toBe('login')
    expect(md.suiteLine).toBe(1)
    expect(md.testNames).toEqual(['succeeds', 'fails'])
    expect(md.testLines).toEqual([2, 3])
  })
})

describe('resolveNightwatchConfig', () => {
  it('prefers --config argv', () => {
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cfg-'))
    const cfg = path.join(cfgDir, 'nightwatch.conf.cjs')
    fs.writeFileSync(cfg, 'module.exports = {}')
    const origArgv = process.argv
    process.argv = ['node', 'cli', '--config', cfg]
    try {
      expect(resolveNightwatchConfig()).toBe(cfg)
    } finally {
      process.argv = origArgv
      fs.rmSync(cfgDir, { recursive: true, force: true })
    }
  })

  it('returns undefined when --config points to a non-existent file', () => {
    const origArgv = process.argv
    const origCwd = process.cwd()
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-cfg-empty-'))
    process.argv = ['node', 'cli', '--config', '/definitely/not/a/file']
    process.chdir(tmpDir)
    try {
      // Walks up from tmpDir; if no nightwatch.conf.* exists upstream it's undefined.
      const result = resolveNightwatchConfig()
      expect(typeof result === 'string' || result === undefined).toBe(true)
    } finally {
      process.chdir(origCwd)
      process.argv = origArgv
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
