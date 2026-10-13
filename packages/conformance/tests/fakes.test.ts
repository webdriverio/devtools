import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { REUSE_ENV, WS_PATHS } from '@wdio/devtools-shared'

import { checkConformance } from '../src/checker.js'
import { RULES } from '../src/constants.js'
import { FakeWebDriver } from '../src/fake-webdriver.js'
import { runAdapter, runScenario } from '../src/harness.js'
import type { WireFrame } from '../src/types.js'

/** The one line every real collector bundle carries: it assigns its global. */
const COLLECTOR_SOURCE = 'window.wdioTraceCollector = new (class {})()'
const PROBE = 'return typeof window.wdioTraceCollector !== "undefined";'
const FORCED_DRAIN =
  'window.wdioTraceCollector.captureCurrentDom(); return window.wdioTraceCollector.getTraceData();'

const drivers: FakeWebDriver[] = []
afterEach(async () => {
  for (const driver of drivers.splice(0)) {
    await driver.close()
  }
})

async function start(bidi: boolean): Promise<FakeWebDriver> {
  const driver = await FakeWebDriver.start({ bidi })
  drivers.push(driver)
  return driver
}

async function call(
  driver: FakeWebDriver,
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetch(`${driver.origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return ((await res.json()) as { value: unknown }).value
}

const session = (driver: FakeWebDriver) =>
  call(driver, 'POST', '/session', {
    capabilities: { alwaysMatch: { webSocketUrl: true } }
  }) as Promise<{ capabilities: { webSocketUrl?: string } }>

const execute = (driver: FakeWebDriver, script: string) =>
  call(driver, 'POST', '/session/conformance/execute/sync', {
    script,
    args: []
  })

async function registerPreload(
  url: string,
  functionDeclaration: string
): Promise<void> {
  const ws = new WebSocket(url)
  await new Promise((resolve) => ws.once('open', resolve))
  const answered = new Promise((resolve) => ws.once('message', resolve))
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'script.addPreloadScript',
      params: { functionDeclaration }
    })
  )
  await answered
  ws.close()
}

describe('the fake BiDi endpoint', () => {
  // Regression: any preload counted as the collector, so an empty one produced a passing stream.
  it('registers a collector preload only when the body is the collector', async () => {
    for (const [body, expected] of [
      ['() => {}', false],
      [`async () => { ${COLLECTOR_SOURCE} }`, true]
    ] as const) {
      const driver = await start(true)
      const { capabilities } = await session(driver)
      await registerPreload(capabilities.webSocketUrl!, body)
      await call(driver, 'POST', '/session/conformance/url', {
        url: driver.url('/login')
      })
      expect(await execute(driver, PROBE), body).toBe(expected)
    }
  })
})

describe('the fake collector', () => {
  // Regression: re-injection kept the document anchored, so a duplicate anchor could never be modelled.
  it('anchors again after a second injection, which one-anchor-per-document flags', async () => {
    const driver = await start(false)
    await session(driver)
    await call(driver, 'POST', '/session/conformance/url', {
      url: driver.url('/login')
    })
    const mutations: unknown[] = []
    for (let i = 0; i < 2; i++) {
      await execute(driver, COLLECTOR_SOURCE)
      const drained = (await execute(driver, FORCED_DRAIN)) as {
        mutations: unknown[]
      }
      mutations.push(...drained.mutations)
    }
    const frames: WireFrame[] = [{ scope: 'mutations', data: mutations }]
    const rules = checkConformance(frames, driver.truth()).map((v) => v.rule)
    expect(rules).toContain(RULES.anchorOnce)
  })
})

describe('the harness', () => {
  // Regression: a timeout rejected, so a hung adapter lost the frames that showed where it hung.
  it('reports a hung scenario as a failed run instead of throwing', async () => {
    const run = await runScenario(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10000)'],
      { bidi: false, timeoutMs: 200 }
    )
    expect(run.exitCode).not.toBe(0)
    expect(run.output).toContain('timed out')
    expect(Array.isArray(run.frames)).toBe(true)
  })
})

describe('runAdapter', () => {
  // Regression: a checker that threw on a malformed frame replaced the recorded run with empty values.
  it('keeps the recorded frames when the checker cannot read them', async () => {
    const script = `const WebSocket = require('ws');
const ws = new WebSocket('ws://' + process.env.${REUSE_ENV.HOST} + ':' + process.env.${REUSE_ENV.PORT} + '${WS_PATHS.worker}?runId=x');
ws.on('open', () => ws.send(JSON.stringify({ scope: 'commands', data: {} }), () => ws.close()));`
    const report = await runAdapter(
      {
        id: 'selenium-devtools',
        ready: () => true,
        prepare: () => ({ command: process.execPath, args: ['-e', script] })
      },
      false
    )
    expect(report.checkerError).toContain('not an array')
    expect(report.frames).toEqual([{ scope: 'commands', data: {} }])
  })
})
