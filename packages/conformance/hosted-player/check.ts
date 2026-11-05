import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { remote } from 'webdriverio'
import { formatTraceLink, TRACE_URL_PARAM } from '@wdio/devtools-shared'
import { parseTraceZip } from '@wdio/devtools-trace/trace-reader'

import {
  CSP_VIOLATION_PREFIX,
  LANDING_HEADING,
  LANDING_TIMEOUT_MS,
  LINKED_ACTION_TITLE,
  LINKED_TAB,
  MAX_EXPAND_PASSES,
  NOT_A_TRACE_ERROR,
  NOT_A_TRACE_NAME,
  OPEN_TIMEOUT_MS
} from './constants.js'
import { CURRENT_TRACE_TITLES, writeCurrentTrace } from './current-trace.js'
import {
  HOSTILE_FLAG,
  HOSTILE_MARKER_ID,
  writeHostileTrace
} from './hostile-trace.js'
import {
  diffTitles,
  failingLogEntry,
  cspDrift,
  readFormatFixtures,
  requestedWorker,
  type TraceToOpen
} from './expectations.js'
import {
  EXPAND_COLLAPSED_ROWS,
  READ_PLAYER_STATE,
  READ_TRACE_POSITION,
  clickRow,
  cspViolationReporter,
  replayLastRow,
  type PlayerState,
  type ReplayState,
  type TracePosition
} from './page-scripts.js'

type Browser = WebdriverIO.Browser

const PAGE_ERRORS = 'The page logged errors:'

/** What the session saw across every page the check opened. */
interface Observed {
  consoleErrors: string[]
  requested: Set<string>
}

export interface CheckOptions {
  baseUrl: string
  headed: boolean
  /** Serves a zip from the player's origin and returns its path; absent for a deployed player, whose `?trace=` open is then not checked. */
  serveZip?: (zipPath: string) => string
}

function log(message: string): void {
  console.log(`hosted-player: ${message}`)
}

/** Without the policy the check would pass against a page that enforces nothing. */
async function assertHostingHeaders(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/`).catch((error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined
    throw new Error(
      `Could not reach ${baseUrl}/: ${cause instanceof Error ? cause.message : String(error)}`
    )
  })
  if (!response.ok) {
    throw new Error(`${baseUrl}/ answered ${response.status}`)
  }
  const drift = cspDrift(response.headers.get('content-security-policy'))
  if (drift) {
    throw new Error(
      `${baseUrl}/ is not served under hostedPlayerCsp(): ${drift}`
    )
  }
}

function chromeCapabilities(headed: boolean): WebdriverIO.Capabilities {
  return {
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: [
        ...(headed ? [] : ['--headless', '--disable-gpu']),
        '--window-size=1600,900'
      ]
    }
  }
}

async function observePage(
  browser: Browser,
  observed: Observed
): Promise<void> {
  if (!browser.isBidi) {
    throw new Error(
      'The check reads console errors and requests over WebDriver BiDi, which this session does not speak'
    )
  }
  browser.on('log.entryAdded', (entry) => {
    const failure = failingLogEntry(entry)
    if (failure) {
      observed.consoleErrors.push(failure)
    }
  })
  browser.on('network.beforeRequestSent', (event) => {
    observed.requested.add(event.request.url)
  })
  await browser.sessionSubscribe({
    events: ['log.entryAdded', 'network.beforeRequestSent']
  })
  await browser.scriptAddPreloadScript({
    functionDeclaration: cspViolationReporter(CSP_VIOLATION_PREFIX)
  })
}

function readState(browser: Browser): Promise<PlayerState> {
  return browser.execute<PlayerState, []>(READ_PLAYER_STATE)
}

/** Polls until `done` holds and returns the state it held on. */
async function waitForState(
  browser: Browser,
  done: (state: PlayerState) => boolean,
  timeout: number,
  timeoutMsg: string
): Promise<PlayerState> {
  let state = await readState(browser)
  await browser.waitUntil(
    async () => {
      state = await readState(browser)
      return done(state)
    },
    { timeout, interval: 100, timeoutMsg }
  )
  return state
}

async function openLanding(browser: Browser, baseUrl: string): Promise<void> {
  await browser.url(`${baseUrl}/`)
  await waitForState(
    browser,
    (state) =>
      state.landing?.heading === LANDING_HEADING && !state.landing.busy,
    LANDING_TIMEOUT_MS,
    `${baseUrl}/ never showed the landing screen ("${LANDING_HEADING}")`
  )
}

async function pickFile(browser: Browser, file: string): Promise<void> {
  const input = await browser
    .$('wdio-devtools')
    .shadow$('wdio-devtools-open-trace')
    .shadow$('input[type="file"]')
  await input.setFiles(file)
}

/** Opens every collapsed group and row, a level per pass, so each action row is rendered. */
async function expandAll(browser: Browser, name: string): Promise<PlayerState> {
  for (let pass = 0; pass < MAX_EXPAND_PASSES; pass++) {
    const opened = await browser.execute<number, []>(EXPAND_COLLAPSED_ROWS)
    if (!opened) {
      return readState(browser)
    }
  }
  throw new Error(
    `${name}: rows still collapsed after ${MAX_EXPAND_PASSES} passes`
  )
}

function assertRendered(trace: TraceToOpen, state: PlayerState): void {
  const { missing, unexpected } = diffTitles(trace.titles, state.rows)
  const problems = [
    ...missing.map((title) => `no row for ${title}`),
    ...unexpected.map((title) => `a row the trace does not hold: ${title}`),
    ...(state.frames ? [] : ['no frame in the filmstrip']),
    ...state.alerts.map((alert) => `an error is shown: ${alert}`)
  ]
  if (problems.length) {
    throw new Error(`${trace.name}:\n  ${problems.join('\n  ')}`)
  }
}

async function openTrace(
  browser: Browser,
  baseUrl: string,
  trace: TraceToOpen,
  observed: Observed
): Promise<void> {
  await openLanding(browser, baseUrl)
  await pickFile(browser, trace.zipPath)
  const opened = await waitForState(
    browser,
    (state) =>
      state.alerts.length > 0 ||
      (state.landing === null && state.rows.length + state.groups > 0),
    OPEN_TIMEOUT_MS,
    `${trace.name}: the player never rendered an action row`
  )
  if (opened.alerts.length) {
    throw new Error(`${trace.name}: ${opened.alerts.join('; ')}`)
  }
  const state = await expandAll(browser, trace.name)
  for (const url of state.resources) {
    observed.requested.add(url)
  }
  assertRendered(trace, state)
  log(`${trace.name}: ${state.rows.length} action rows, ${state.frames} frames`)
}

/** A trace is untrusted input: its replayed DOM must not run script, by any path. */
async function openHostileTrace(
  browser: Browser,
  baseUrl: string,
  workDir: string
): Promise<void> {
  await openLanding(browser, baseUrl)
  await pickFile(browser, await writeHostileTrace(workDir))
  await waitForState(
    browser,
    (state) => state.landing === null && state.rows.length > 0,
    OPEN_TIMEOUT_MS,
    'hostile trace: the player never rendered an action row'
  )
  const replay = await browser.execute<ReplayState, []>(
    replayLastRow(HOSTILE_MARKER_ID, HOSTILE_FLAG)
  )
  const problems = [
    ...(replay.replayed
      ? []
      : ['its page was never replayed, so nothing was tested']),
    ...(replay.sandbox === 'allow-same-origin'
      ? []
      : [
          `the replay frame's sandbox is ${JSON.stringify(replay.sandbox)}, not "allow-same-origin"`
        ]),
    ...(replay.scripts
      ? [`${replay.scripts} <script> element(s) reached the replay frame`]
      : []),
    ...(replay.ran ? [`its script ran in the player (${replay.ran})`] : [])
  ]
  if (problems.length) {
    throw new Error(`hostile trace:\n  ${problems.join('\n  ')}`)
  }
  log('hostile trace: replayed with no script run')
}

/** The callId the trace reader gives the action titled `title` in the zip at `zipPath`. */
async function callIdOf(zipPath: string, title: string): Promise<string> {
  const { trace } = parseTraceZip(new Uint8Array(await fs.readFile(zipPath)))
  const callId = trace.commands.find(
    (command) => command.title === title
  )?.callId
  if (!callId) {
    throw new Error(`${zipPath} holds no action titled ${title}`)
  }
  return callId
}

function readPosition(browser: Browser): Promise<TracePosition> {
  return browser.execute<TracePosition, []>(READ_TRACE_POSITION)
}

/** Waits for the open to show the linked action selected on the linked tab. */
async function expectLinkedPosition(
  browser: Browser,
  name: string,
  link: string
): Promise<void> {
  let position = await readPosition(browser)
  await browser
    .waitUntil(
      async () => {
        position = await readPosition(browser)
        return (
          position.activeRow === LINKED_ACTION_TITLE &&
          position.dockTab === LINKED_TAB
        )
      },
      { timeout: OPEN_TIMEOUT_MS, interval: 100 }
    )
    .catch(() => {
      throw new Error(
        `${name}: #${link} selected ${position.activeRow} on ${position.dockTab}, not ${LINKED_ACTION_TITLE} on ${LINKED_TAB}`
      )
    })
}

/** Picks another action row and waits for its callId to reach the address. */
async function expectAddressFollowsPick(
  browser: Browser,
  name: string,
  trace: TraceToOpen
): Promise<void> {
  const picked = trace.titles.find((title) => title !== LINKED_ACTION_TITLE)
  if (!picked) {
    throw new Error(`${name}: the trace holds no other action to pick`)
  }
  const expected = await callIdOf(trace.zipPath, picked)
  if (!(await browser.execute<boolean, []>(clickRow(picked)))) {
    throw new Error(`${name}: no row for ${picked} to pick`)
  }
  await browser.waitUntil(
    async () =>
      (await readPosition(browser)).hash.includes(`action=${expected}`),
    {
      timeout: OPEN_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${name}: picking ${picked} never wrote action=${expected} into the address`
    }
  )
}

/** Opens a zip by `?trace=` with a deep link, then expects the linked action and tab, and the address to follow a pick. */
async function openLinkedTraceUrl(
  browser: Browser,
  baseUrl: string,
  trace: TraceToOpen,
  route: string
): Promise<void> {
  const name = `${trace.name} by ?${TRACE_URL_PARAM}=`
  const link = formatTraceLink({
    action: await callIdOf(trace.zipPath, LINKED_ACTION_TITLE),
    tab: LINKED_TAB.toLowerCase()
  })
  await browser.url(
    `${baseUrl}/?${TRACE_URL_PARAM}=${encodeURIComponent(route)}#${link}`
  )
  const opened = await waitForState(
    browser,
    (state) =>
      state.alerts.length > 0 ||
      (state.landing === null && state.rows.length > 0),
    OPEN_TIMEOUT_MS,
    `${name}: the player never rendered an action row`
  )
  if (opened.alerts.length) {
    throw new Error(`${name}: ${opened.alerts.join('; ')}`)
  }
  await expectLinkedPosition(browser, name, link)
  await expectAddressFollowsPick(browser, name, trace)
  log(
    `${name}: opened at ${LINKED_ACTION_TITLE} on ${LINKED_TAB}, address follows a pick`
  )
}

async function openNotATrace(
  browser: Browser,
  baseUrl: string,
  workDir: string
): Promise<void> {
  const file = path.join(workDir, NOT_A_TRACE_NAME)
  await fs.writeFile(file, 'this is not a zip\n')
  await openLanding(browser, baseUrl)
  await pickFile(browser, file)
  const state = await waitForState(
    browser,
    (current) => Boolean(current.landing?.error),
    OPEN_TIMEOUT_MS,
    `${NOT_A_TRACE_NAME}: the landing screen never reported an error`
  )
  const error = state.landing?.error ?? ''
  if (!error.startsWith(NOT_A_TRACE_ERROR)) {
    throw new Error(
      `${NOT_A_TRACE_NAME}: expected "${NOT_A_TRACE_ERROR} …", got "${error}"`
    )
  }
  log(`${NOT_A_TRACE_NAME}: ${error}`)
}

function assertObserved(observed: Observed): void {
  const worker = requestedWorker(observed.requested)
  if (!worker) {
    throw new Error(
      'The parse worker script was never requested, so no trace was read in a Web Worker'
    )
  }
  log(`parse worker requested: ${worker}`)
  if (observed.consoleErrors.length) {
    throw new Error(`${PAGE_ERRORS}\n  ${observed.consoleErrors.join('\n  ')}`)
  }
}

/** A step that failed first is often explained by an error the page logged before it. */
function withConsoleErrors(error: unknown, observed: Observed): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (!observed.consoleErrors.length || message.startsWith(PAGE_ERRORS)) {
    return error instanceof Error ? error : new Error(message)
  }
  return new Error(
    `${message}\n${PAGE_ERRORS}\n  ${observed.consoleErrors.join('\n  ')}`
  )
}

async function tracesToOpen(workDir: string): Promise<TraceToOpen[]> {
  return [
    ...readFormatFixtures(),
    {
      name: 'current-writer',
      zipPath: await writeCurrentTrace(workDir),
      titles: CURRENT_TRACE_TITLES
    }
  ]
}

/** Opens every trace and a non-zip in the hosted player at `baseUrl`; throws on the first thing that is wrong. */
export async function checkHostedPlayer({
  baseUrl,
  headed,
  serveZip
}: CheckOptions): Promise<void> {
  await assertHostingHeaders(baseUrl)
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hosted-player-'))
  const browser = await remote({
    logLevel: 'warn',
    capabilities: chromeCapabilities(headed)
  })
  const observed: Observed = { consoleErrors: [], requested: new Set() }
  try {
    await observePage(browser, observed)
    const traces = await tracesToOpen(workDir)
    for (const trace of traces) {
      await openTrace(browser, baseUrl, trace, observed)
    }
    const current = traces[traces.length - 1]
    if (serveZip) {
      await openLinkedTraceUrl(
        browser,
        baseUrl,
        current,
        serveZip(current.zipPath)
      )
    } else {
      log(
        `?${TRACE_URL_PARAM}= not checked: a deployed player has no zip on its own origin`
      )
    }
    await openHostileTrace(browser, baseUrl, workDir)
    await openNotATrace(browser, baseUrl, workDir)
    assertObserved(observed)
  } catch (error) {
    throw withConsoleErrors(error, observed)
  } finally {
    await browser.deleteSession()
    await fs.rm(workDir, { recursive: true, force: true })
  }
}
