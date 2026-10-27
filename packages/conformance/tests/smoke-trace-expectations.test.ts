import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yazl from 'yazl'

import {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type TestMetadataMap,
  type TraceLog
} from '@wdio/devtools-shared'
import { exportTraceZip } from '@wdio/devtools-trace'

import {
  checkExample,
  findTimeout,
  readSmokeTrace
} from '../smoke/trace-expectations.js'
import type { ExampleExpectations, SmokeTrace } from '../smoke/types.js'

const EXPECTATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../smoke/expectations'
)

let clock = 1_000

function cmd(
  command: string,
  testUid: string,
  overrides: Partial<CommandLog> = {}
): CommandLog {
  clock += 100
  return {
    command,
    args: ['#target'],
    timestamp: clock,
    startTime: clock - 50,
    testUid,
    ...overrides
  }
}

const metadata: TestMetadataMap = new Map([
  ['suite-login', { title: 'Login', specFile: 'login.e2e.ts' }],
  [
    'test-pass',
    {
      title: 'Login logs in with valid credentials',
      specFile: 'login.e2e.ts',
      ancestry: [{ uid: 'suite-login', title: 'Login', kind: 'suite' }]
    }
  ],
  [
    'test-fail',
    {
      title: 'Login asserts the wrong flash message',
      specFile: 'login.e2e.ts',
      ancestry: [{ uid: 'suite-login', title: 'Login', kind: 'suite' }]
    }
  ],
  [
    'test-nodeid',
    {
      title: 'test_login.py::TestLogin::test_rejects_invalid_credentials',
      specFile: 'test_login.py'
    }
  ]
])

function traceLog(
  commands: CommandLog[],
  consoleLogs: ConsoleLog[] = []
): TraceLog {
  return {
    mutations: [],
    logs: [],
    consoleLogs,
    networkRequests: [],
    metadata: { type: TraceType.Standalone },
    commands,
    sources: {}
  }
}

async function zipOf(
  commands: CommandLog[],
  consoleLogs: ConsoleLog[] = []
): Promise<Buffer> {
  return exportTraceZip(traceLog(commands, consoleLogs), {
    sessionId: 'smoke',
    wallTimeOverride: 1_000,
    testMetadata: metadata
  })
}

const passingRun = () => [
  cmd('url', 'test-pass', { args: ['http://127.0.0.1/login'] }),
  cmd('setValue', 'test-pass', { args: ['#username', 'tomsmith'] }),
  cmd('setValue', 'test-pass', { args: ['#password', 'secret'] }),
  cmd('click', 'test-pass', { args: ['button'] }),
  cmd('expect.toHaveText', 'test-pass', { args: ['You logged in'] })
]

const failingRun = () => [
  cmd('url', 'test-fail', { args: ['http://127.0.0.1/login'] }),
  cmd('expect.toHaveText', 'test-fail', {
    args: ['You logged in'],
    error: new Error('Expect $(`#flash`) to have text containing')
  })
]

const expectations: ExampleExpectations = {
  example: 'unit',
  runFails: true,
  tests: [
    {
      test: 'logs in with valid credentials',
      rows: ['Page.navigate', 'Element.fill', 'Element.fill', 'Element.click'],
      error: false
    },
    {
      test: 'asserts the wrong flash message',
      rows: ['Page.navigate', 'Assert.toHaveText'],
      error: true,
      errorMatches: 'to have text'
    }
  ]
}

async function parsed(
  commands: CommandLog[],
  consoleLogs?: ConsoleLog[]
): Promise<SmokeTrace> {
  const [trace] = readSmokeTrace(
    'trace-smoke.zip',
    await zipOf(commands, consoleLogs)
  )
  return trace!
}

async function rawZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  for (const [name, body] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(body), name)
  }
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const ndjson = (...events: object[]) =>
  events.map((e) => JSON.stringify(e)).join('\n')

describe('readSmokeTrace', () => {
  it('reads every .trace stream on its own and ignores other entries', async () => {
    const zip = await rawZip({
      'trace.trace': ndjson({
        type: 'before',
        callId: 'call@1',
        class: 'Page',
        method: 'navigate'
      }),
      'page2.trace': ndjson(
        { type: 'before', callId: 'call@1', class: 'Element', method: 'click' },
        { type: 'after', callId: 'call@1', error: { message: 'boom' } }
      ),
      'trace.network': '{}'
    })
    const traces = readSmokeTrace('t.zip', zip)
    expect(traces.map((t) => t.source)).toEqual([
      't.zip:page2.trace',
      't.zip:trace.trace'
    ])
    expect(traces.map((t) => t.rows.map((r) => [r.label, r.error]))).toEqual([
      [['Element.click', 'boom']],
      [['Page.navigate', undefined]]
    ])
  })

  it('throws when the zip carries no .trace stream', async () => {
    const zip = await rawZip({ 'trace.network': '{}' })
    expect(() => readSmokeTrace('t.zip', zip)).toThrow(
      't.zip: no *.trace stream'
    )
  })

  it('names the line that is not JSON', async () => {
    const zip = await rawZip({ 'trace.trace': '{"type":"before"}\nnot json' })
    expect(() => readSmokeTrace('t.zip', zip)).toThrow(
      /^t\.zip: line 2 is not JSON/
    )
  })
})

describe('findTimeout', () => {
  it.each([
    ['selenium-webdriver', 'TimeoutError: Wait timed out after 10054ms'],
    ['selenium-webdriver, message only', 'Wait timed out after 10054ms'],
    [
      'Nightwatch waitForElementVisible',
      'Timed out while waiting for element <#flash> to be visible for 5000 milliseconds.'
    ],
    [
      'Nightwatch locator',
      'Timed out while waiting for element "#flash" with "css selector" to be present for 5000 milliseconds.'
    ],
    [
      'WebdriverIO waitForDisplayed',
      'element ("#flash") still not displayed after 10000ms'
    ],
    [
      'WebdriverIO waitForExist',
      'element ("#flash") still not existing after 10000ms'
    ],
    [
      'WebdriverIO waitForDisplayed({ reverse: true })',
      'element ("#flash") still displayed after 10000ms'
    ],
    [
      'WebdriverIO waitForDisplayed within viewport',
      'element ("#flash") still not displayed within viewport after 10000ms'
    ],
    ['WebdriverIO waitUntil', 'waitUntil condition timed out after 5000ms'],
    ['Python selenium', 'selenium.common.exceptions.TimeoutException: Message:']
  ])('detects %s', (_runner, line) => {
    expect(findTimeout(line)).toBe(true)
  })

  it.each([
    'Expect $(`#flash`) to have text containing',
    'Testing if element <#flash> contains text - expected "contains text" but got: "Your username is invalid!"',
    'AssertionError: Expected: "This Is Not The Heading" / Received: "Login Page"',
    'mocha timeout of 60000ms is configured'
  ])('ignores "%s"', (line) => {
    expect(findTimeout(line)).toBe(false)
  })
})

describe('checkExample', () => {
  it('passes a run whose rows, errors and exit code match', async () => {
    const trace = await parsed([...passingRun(), ...failingRun()])
    expect(trace.rows.map((r) => r.label)).toContain('Assert.toHaveText')
    expect(checkExample(expectations, [trace], { exitCode: 1 })).toEqual([])
  })

  it('merges rows across the zips of a multi-worker run', async () => {
    const traces = [await parsed(passingRun()), await parsed(failingRun())]
    expect(checkExample(expectations, traces)).toEqual([])
  })

  it('names the test and the missing row', async () => {
    const run = passingRun().filter((c) => c.command !== 'click')
    const failures = checkExample(expectations, [
      await parsed([...run, ...failingRun()])
    ])
    expect(failures).toEqual([
      expect.stringMatching(
        /^test "logs in with valid credentials": missing rows Element\.click; found Page\.navigate, Element\.fill, Element\.fill, Assert\.toHaveText$/
      )
    ])
  })

  it('counts a row listed twice as needing two occurrences', async () => {
    const run = passingRun().filter(
      (c) => !(c.command === 'setValue' && c.args[0] === '#password')
    )
    const failures = checkExample(expectations, [
      await parsed([...run, ...failingRun()])
    ])
    expect(failures[0]).toMatch(/missing rows Element\.fill;/)
  })

  it('fails a deliberately failing test whose error row is missing', async () => {
    const quiet = failingRun().map(({ error: _error, ...rest }) => rest)
    const failures = checkExample(expectations, [
      await parsed([...passingRun(), ...quiet])
    ])
    expect(failures).toEqual([
      expect.stringMatching(
        /test "asserts the wrong flash message": expected an error row, found none/
      ),
      expect.stringMatching(/no error row mentions "to have text"/)
    ])
  })

  it('fails a passing test that carries an error row', async () => {
    const run = passingRun()
    run[3] = { ...run[3]!, error: new Error('element not interactable') }
    const failures = checkExample(expectations, [
      await parsed([...run, ...failingRun()])
    ])
    expect(failures).toEqual([
      'test "logs in with valid credentials": unexpected error rows: Element.click: element not interactable'
    ])
  })

  it('matches only the nearest group, never an ancestor', async () => {
    const failures = checkExample(
      { ...expectations, tests: [{ test: 'Login', rows: ['Page.navigate'] }] },
      [await parsed(passingRun())]
    )
    expect(failures[0]).toMatch(/^test "Login": no rows under a group/)
  })

  it('matches a nodeid-titled group by its last segment', async () => {
    const trace = await parsed([
      cmd('url', 'test-nodeid', { args: ['http://127.0.0.1/login'] })
    ])
    const byName: ExampleExpectations = {
      example: 'unit',
      runFails: false,
      tests: [
        { test: 'test_rejects_invalid_credentials', rows: ['Page.navigate'] }
      ]
    }
    expect(checkExample(byName, [trace])).toEqual([])
    const partial = {
      ...byName,
      tests: [{ test: 'invalid_credentials', rows: ['Page.navigate'] }]
    }
    expect(checkExample(partial, [trace])[0]).toMatch(/no rows under a group/)
  })

  it('lists the groups it saw when no group matches the test', async () => {
    const failures = checkExample(
      { ...expectations, tests: [{ test: 'no such test', rows: [] }] },
      [await parsed(passingRun())]
    )
    expect(failures[0]).toMatch(
      /^test "no such test": no rows under a group with that title; groups seen: "Login", /
    )
  })

  it('checks the whole run for a run-scoped expectation', async () => {
    const trace = await parsed([...passingRun(), ...failingRun()])
    const whole: ExampleExpectations = {
      example: 'unit',
      runFails: true,
      tests: [
        {
          scope: 'run',
          reason: 'no per-test groups',
          rows: ['Page.navigate', 'Page.navigate'],
          error: true
        }
      ]
    }
    expect(checkExample(whole, [trace])).toEqual([])
  })

  it('fails on a TimeoutError in the trace stdout unless allowed', async () => {
    const trace = await parsed(
      [...passingRun(), ...failingRun()],
      [
        {
          type: 'error',
          args: ['TimeoutError: Wait timed out after 10054ms'],
          timestamp: 1_500,
          source: 'test'
        }
      ]
    )
    expect(checkExample(expectations, [trace])).toEqual([
      'trace-smoke.zip: stdout carries a timeout: TimeoutError: Wait timed out after 10054ms'
    ])
    expect(
      checkExample({ ...expectations, allowTimeoutError: true }, [trace])
    ).toEqual([])
  })

  it('ignores a timeout logged by the page, which is not stdout', async () => {
    const trace = await parsed(
      [...passingRun(), ...failingRun()],
      [
        {
          type: 'error',
          args: ['TimeoutError'],
          timestamp: 1_500,
          source: 'browser'
        }
      ]
    )
    expect(checkExample(expectations, [trace])).toEqual([])
  })

  it('fails on a Nightwatch wait timeout in the trace stdout', async () => {
    const trace = await parsed(
      [...passingRun(), ...failingRun()],
      [
        {
          type: 'log',
          args: [
            'Timed out while waiting for element <#flash> to be visible for 5000 milliseconds.'
          ],
          timestamp: 1_500,
          source: 'terminal'
        }
      ]
    )
    expect(checkExample(expectations, [trace])).toEqual([
      expect.stringMatching(
        /^trace-smoke\.zip: stdout carries a timeout: Timed out/
      )
    ])
  })

  it('fails on a timeout in the runner log', async () => {
    const trace = await parsed([...passingRun(), ...failingRun()])
    const log =
      'spec ok\n  selenium.common.exceptions.TimeoutException: Message:\n'
    expect(checkExample(expectations, [trace], { log })).toEqual([
      'runner log carries a timeout: selenium.common.exceptions.TimeoutException: Message:'
    ])
  })

  it('checks the exit code against runFails', async () => {
    const trace = await parsed([...passingRun(), ...failingRun()])
    expect(checkExample(expectations, [trace], { exitCode: 0 })).toEqual([
      'run exited 0, expected a failing exit (it has deliberately failing tests)'
    ])
    expect(
      checkExample({ ...expectations, runFails: false }, [trace], {
        exitCode: 1
      })
    ).toEqual(['run exited 1, expected 0'])
  })

  it('fails when the run produced no trace', () => {
    expect(checkExample(expectations, [])).toEqual([
      'no trace-*.zip was produced'
    ])
  })
})

describe('shipped expectation files', () => {
  const files = fs.readdirSync(EXPECTATIONS_DIR)

  it('covers one example per adapter', () => {
    expect(files.sort()).toEqual([
      'nightwatch-bdd.json',
      'python-pytest.json',
      'selenium-mocha.json',
      'wdio-mocha.json'
    ])
  })

  it.each(files)('%s names itself and uses Class.method row labels', (file) => {
    const parsedFile = JSON.parse(
      fs.readFileSync(path.join(EXPECTATIONS_DIR, file), 'utf8')
    ) as ExampleExpectations
    expect(parsedFile.example).toBe(file.replace(/\.json$/, ''))
    expect(typeof parsedFile.runFails).toBe('boolean')
    expect(parsedFile.tests.length).toBeGreaterThan(0)
    for (const test of parsedFile.tests) {
      if (test.scope === 'run') {
        expect(test.reason.length).toBeGreaterThan(0)
      } else {
        expect(test.test.length).toBeGreaterThan(0)
      }
      for (const row of test.rows ?? []) {
        expect(row).toMatch(/^[A-Z]\w*\.\w+$/)
      }
    }
  })
})
