import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { REUSE_ENV, WS_PATHS, type NetworkRequest } from '@wdio/devtools-shared'

import { checkConformance } from '../src/checker.js'
import {
  ELEMENT_KEY,
  ELEMENT_TEXT,
  RENDERED_AFTER_MS,
  RULES
} from '../src/constants.js'
import { FakeWebDriver } from '../src/fake-webdriver.js'
import { runAdapter, runScenario } from '../src/harness.js'
import type { BidiMode, WireFrame } from '../src/types.js'

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

async function start(bidi: BidiMode): Promise<FakeWebDriver> {
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

async function bidiClient(url: string) {
  const ws = new WebSocket(url)
  await new Promise((resolve) => ws.once('open', resolve))
  let id = 0
  return {
    send: (method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        ws.once('message', (raw) => resolve(JSON.parse(String(raw))))
        ws.send(JSON.stringify({ id: ++id, method, params }))
      }),
    close: () => ws.close()
  }
}

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
      const driver = await start('silent')
      const { capabilities } = await session(driver)
      await registerPreload(capabilities.webSocketUrl!, body)
      await call(driver, 'POST', '/session/conformance/url', {
        url: driver.url('/login')
      })
      expect(await execute(driver, PROBE), body).toBe(expected)
    }
  })

  // WebdriverIO routes navigation, element lookup and scripts over BiDi once a session offers it.
  it('drives the same pages over BiDi and stamps the same user actions', async () => {
    const driver = await start('silent')
    const { capabilities } = await session(driver)
    const client = await bidiClient(capabilities.webSocketUrl!)
    const context = 'window-1'
    const call = (functionDeclaration: string) =>
      client.send('script.callFunction', {
        functionDeclaration,
        arguments: [],
        target: { context }
      })
    try {
      const navigated = await client.send('browsingContext.navigate', {
        context,
        url: driver.url('/login'),
        wait: 'complete'
      })
      expect(navigated.type).toBe('success')
      const located = await client.send('browsingContext.locateNodes', {
        context,
        locator: { type: 'css', value: '#username' }
      })
      const { nodes } = located.result as { nodes: { sharedId: string }[] }
      expect(nodes).toHaveLength(1)
      await call(`function () { ${COLLECTOR_SOURCE} }`)
      const drained = await call(`function () { ${FORCED_DRAIN} }`)
      const { result } = drained.result as {
        result: { type: string; value: [string, unknown][] }
      }
      expect(result.type).toBe('object')
      expect(result.value.map(([key]) => key)).toContain('mutations')
      const refused = await client.send('browsingContext.navigate', {
        context,
        url: driver.url('/broken'),
        wait: 'complete'
      })
      expect(refused).toMatchObject({
        type: 'error',
        message: 'net::ERR_FAILED at /broken'
      })
    } finally {
      client.close()
    }
    const truth = driver.truth()
    expect(truth.documents.map((d) => new URL(d.url).pathname)).toEqual([
      '/login'
    ])
    expect(truth.actions.navigate).toHaveLength(2)
    expect(truth.failedNavigations).toHaveLength(1)
  })
})

describe('the fake network', () => {
  const navigate = (driver: FakeWebDriver, path: string) =>
    call(driver, 'POST', '/session/conformance/url', { url: driver.url(path) })
  const drained = (driver: FakeWebDriver) =>
    execute(driver, FORCED_DRAIN) as Promise<{
      networkRequests: NetworkRequest[]
    }>

  it('records three loads per document and drains them once, as the page’s Resource Timing', async () => {
    const driver = await start('off')
    await session(driver)
    await navigate(driver, '/login')
    await execute(driver, COLLECTOR_SOURCE)
    const first = await drained(driver)
    expect(
      first.networkRequests.map((r) => [
        new URL(r.url).pathname,
        r.source,
        r.status,
        r.method
      ])
    ).toEqual([
      ['/login', 'resource-timing', undefined, ''],
      ['/app.js', 'resource-timing', undefined, 'GET'],
      ['/app.css', 'resource-timing', undefined, 'GET']
    ])
    expect((await drained(driver)).networkRequests).toEqual([])
    expect(driver.truth().requests).toHaveLength(3)
    expect(driver.truth().bidi).toBe('off')
  })

  it('serves no socket to a session that did not ask, and the truth says so', async () => {
    // What a row must carry depends on what the session was served, not on what the mode offered.
    const driver = await start('live')
    const { capabilities } = (await call(driver, 'POST', '/session', {
      capabilities: { alwaysMatch: {} }
    })) as { capabilities: { webSocketUrl?: string } }
    expect(capabilities.webSocketUrl).toBeUndefined()
    expect(driver.truth().bidi).toBe('off')
  })

  it('emits each load over a live socket to the client that subscribed, and nothing over a silent one', async () => {
    for (const [mode, expected] of [
      ['live', 6],
      ['silent', 0]
    ] as const) {
      const driver = await start(mode)
      const { capabilities } = await session(driver)
      const ws = new WebSocket(capabilities.webSocketUrl!)
      await new Promise((resolve) => ws.once('open', resolve))
      const events: { method: string; params: Record<string, unknown> }[] = []
      ws.on('message', (raw) => {
        const message = JSON.parse(String(raw))
        if (message.type === 'event') {
          events.push(message)
        }
      })
      const acknowledged = new Promise((resolve) => ws.once('message', resolve))
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'session.subscribe',
          params: {
            events: ['network.beforeRequestSent', 'network.responseCompleted']
          }
        })
      )
      await acknowledged
      await navigate(driver, '/login')
      await new Promise((resolve) => setTimeout(resolve, 50))
      ws.close()
      expect(events, mode).toHaveLength(expected)
      if (expected === 0) {
        continue
      }
      expect(events.map((e) => e.method)).toEqual([
        'network.beforeRequestSent',
        'network.responseCompleted',
        'network.beforeRequestSent',
        'network.responseCompleted',
        'network.beforeRequestSent',
        'network.responseCompleted'
      ])
      const completed = events[1].params as {
        request: { request: string }
        response: { status: number; headers: { name: string }[] }
      }
      expect(events[0].params).toMatchObject({
        request: { request: completed.request.request },
        initiator: { type: 'other' }
      })
      expect(completed.response.status).toBe(200)
      expect(completed.response.headers.map((h) => h.name)).toEqual([
        'content-type'
      ])
    }
  })

  it('subscribes nobody who never asked, so an unsubscribed client hears no event', async () => {
    const driver = await start('live')
    const { capabilities } = await session(driver)
    const ws = new WebSocket(capabilities.webSocketUrl!)
    await new Promise((resolve) => ws.once('open', resolve))
    const events: unknown[] = []
    ws.on('message', (raw) => {
      if (JSON.parse(String(raw)).type === 'event') {
        events.push(raw)
      }
    })
    await navigate(driver, '/login')
    await new Promise((resolve) => setTimeout(resolve, 50))
    ws.close()
    expect(events).toEqual([])
  })
})

describe('the fake collector', () => {
  // Regression: re-injection kept the document anchored, so a duplicate anchor could never be modelled.
  it('anchors again after a second injection, which one-anchor-per-document flags', async () => {
    const driver = await start('off')
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
    const rules = checkConformance(frames, {
      ...driver.truth(),
      scenarioFile: { paths: [], lines: 0 }
    }).map((v) => v.rule)
    expect(rules).toContain(RULES.anchorOnce)
  })
})

describe('the fake page', () => {
  const find = (driver: FakeWebDriver, value: string) =>
    call(driver, 'POST', '/session/conformance/elements', {
      using: 'css selector',
      value
    }) as Promise<Record<string, string>[]>

  // A wait for an element that is there at once never polls, which is the path the scenario's wait exists to cover.
  it('renders the flash late, so a wait for it polls, and reads back its text', async () => {
    const driver = await start('off')
    await session(driver)
    await call(driver, 'POST', '/session/conformance/url', {
      url: driver.url('/secure')
    })
    expect(await find(driver, '#flash')).toEqual([])
    await new Promise((r) => setTimeout(r, RENDERED_AFTER_MS['#flash']))
    const [ref] = await find(driver, '#flash')
    const id = ref[ELEMENT_KEY]
    expect(
      await call(driver, 'GET', `/session/conformance/element/${id}/text`)
    ).toBe(ELEMENT_TEXT['/secure']['#flash'])
    expect(driver.truth().actions).toEqual({
      navigate: [expect.any(Number)],
      click: [],
      fill: []
    })
  })

  it('never renders an element the page does not have', async () => {
    const driver = await start('off')
    await session(driver)
    await call(driver, 'POST', '/session/conformance/url', {
      url: driver.url('/login')
    })
    expect(await find(driver, '#missing')).toEqual([])
  })
})

describe('the harness', () => {
  // Regression: a timeout rejected, so a hung adapter lost the frames that showed where it hung.
  it('reports a hung scenario as a failed run instead of throwing', async () => {
    const run = await runScenario(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10000)'],
      { bidi: 'off', timeoutMs: 200 }
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
        exitCode: 0,
        ready: () => true,
        prepare: () => ({
          scenarioFile: fileURLToPath(import.meta.url),
          command: process.execPath,
          args: ['-e', script]
        })
      },
      'off'
    )
    expect(report.checkerError).toContain('not an array')
    expect(report.frames).toEqual([{ scope: 'commands', data: {} }])
  })

  // Nightwatch's transport re-issues a refused navigation on its own, with the adapter's own reads in between.
  it("counts a client's retries of a refused navigation as the one action the user issued", async () => {
    const driver = await start('off')
    await session(driver)
    const navigate = (path: string) =>
      call(driver, 'POST', '/session/conformance/url', {
        url: driver.url(path)
      })
    await navigate('/login')
    await navigate('/broken')
    await navigate('/broken')
    await call(driver, 'GET', '/session/conformance/url')
    await navigate('/broken')
    await navigate('/login')
    await navigate('/broken')
    const truth = driver.truth()
    expect(truth.actions.navigate).toHaveLength(4)
    expect(truth.failedNavigations).toHaveLength(2)
  })
})
