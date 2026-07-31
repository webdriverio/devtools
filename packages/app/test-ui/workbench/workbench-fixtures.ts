// Mount harness + data for the workbench parent spec.
//
// The workbench takes everything by context and nothing by property, so its
// spec needs what `mountWithContext` cannot give it: a handle on the providers,
// so a baseline can be preserved and dropped — and a different test selected —
// *after* the mount; those two contexts joined are where the Compare tab lives.
// The provider set mirrors DataManagerController's constructor one for one, so
// the element sees exactly the context surface the running app gives it (a panel
// whose context is missing altogether renders a different empty state than one
// reading `[]`).
//
// The values published here go through the same `ContextProvider.setValue` the
// controller calls on a WS frame; the frame → provider hop itself is covered in
// packages/app/tests/data-manager.test.ts.

import { ContextProvider, type Context } from '@lit/context'
import type {
  CommandLog,
  ConsoleLog,
  NetworkRequest,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'

import {
  actionGroupsContext,
  baselineContext,
  commandContext,
  consoleLogContext,
  framesContext,
  hasConnectionContext,
  logContext,
  metadataBySessionContext,
  metadataContext,
  mutationContext,
  networkRequestContext,
  selectedTestUidContext,
  sourceContext,
  suiteContext,
  transcriptContext
} from '@/controller/context.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '@/controller/types.js'
import '@components/workbench.js'
import type { DevtoolsWorkbench } from '@components/workbench.js'
import type { DevtoolsTabs } from '@components/tabs.js'
import type { DevtoolsTab } from '@components/tabs.js'

import { commandLog } from '../support/builders.js'

export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'

/** Wall-clock origin of the fixture run. */
const RUN_START = 1_700_000_000_000

export const SELECTED_TEST_UID = 'login-test'
export const OTHER_TEST_UID = 'checkout-test'
/** A test no baseline is ever preserved for — selecting it must offer nothing. */
export const UNPRESERVED_TEST_UID = 'signup-test'

const FLASH_SELECTOR = '#flash'
const SUBMIT_SELECTOR = 'button[type="submit"]'
const EXPECTED_FLASH = 'You logged into a secure area!'
const BASELINE_FLASH = 'Your password is invalid!'

/** The run that was preserved: the flash text read back wrong, so the last
 *  command is the failure site. */
const baselineCommands: CommandLog[] = [
  commandLog({ command: 'url', args: [LOGIN_URL], timestamp: RUN_START }),
  commandLog({
    command: 'setValue',
    args: ['#username', 'tomsmith'],
    timestamp: RUN_START + 400
  }),
  commandLog({
    command: 'click',
    args: [SUBMIT_SELECTOR],
    timestamp: RUN_START + 900
  }),
  commandLog({
    command: 'getText',
    args: [FLASH_SELECTOR],
    result: BASELINE_FLASH,
    timestamp: RUN_START + 1400
  })
]

/** The rerun, which got the password right — same commands, different read. */
export const liveCommands: CommandLog[] = [
  commandLog({
    command: 'url',
    args: [LOGIN_URL],
    timestamp: RUN_START + 9000
  }),
  commandLog({
    command: 'setValue',
    args: ['#username', 'tomsmith'],
    timestamp: RUN_START + 9400
  }),
  commandLog({
    command: 'click',
    args: [SUBMIT_SELECTOR],
    timestamp: RUN_START + 9900
  }),
  commandLog({
    command: 'getText',
    args: [FLASH_SELECTOR],
    result: EXPECTED_FLASH,
    timestamp: RUN_START + 10_400
  })
]

/** A live command that errored — one of the two sources the Errors tab collects. */
export const erroringCommand: CommandLog = commandLog({
  command: 'click',
  args: [SUBMIT_SELECTOR],
  timestamp: RUN_START + 11_000,
  error: {
    name: 'element click intercepted',
    message:
      'element click intercepted: another element would receive the click'
  }
})

const failedStep: PreservedStep = {
  uid: 'assert-step',
  title: 'sees the success banner',
  fullTitle: 'login page sees the success banner',
  start: RUN_START + 1000,
  end: RUN_START + 1500,
  state: 'failed',
  error: {
    message: `Expected: "${EXPECTED_FLASH}"\nReceived: "${BASELINE_FLASH}"`
  }
}

export function preservedAttempt(
  overrides: Partial<PreservedAttempt> = {}
): PreservedAttempt {
  return {
    testUid: SELECTED_TEST_UID,
    scope: 'test',
    capturedAt: RUN_START + 2000,
    window: { start: RUN_START, end: RUN_START + 1500 },
    test: {
      title: 'logs in with valid credentials',
      fullTitle: 'login page logs in with valid credentials',
      file: '/specs/login.e2e.ts',
      state: 'failed',
      error: { message: `Expected: "${EXPECTED_FLASH}"` }
    },
    steps: [failedStep],
    commands: baselineCommands,
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    sources: {},
    ...overrides
  }
}

/** The baseline map as DataManager publishes it: keyed by preserved test uid. */
export function baselineMap(
  ...entries: [string, PreservedAttempt][]
): Map<string, PreservedAttempt> {
  return new Map(entries)
}

export const preservedCommands = (): CommandLog[] => baselineCommands

export function consoleLogs(): ConsoleLog[] {
  return [
    {
      type: 'log',
      args: ['[TEST] logging in'],
      source: 'browser',
      timestamp: RUN_START + 100
    },
    {
      type: 'error',
      args: ['Failed to load resource: /favicon.ico'],
      source: 'browser',
      timestamp: RUN_START + 700
    },
    {
      type: 'info',
      args: ['navigating to /secure'],
      source: 'test',
      timestamp: RUN_START + 1200
    }
  ]
}

export function networkRequests(): NetworkRequest[] {
  return [
    {
      id: 'req-1',
      url: LOGIN_URL,
      method: 'GET',
      status: 200,
      type: 'document',
      timestamp: RUN_START + 50,
      startTime: RUN_START + 50
    },
    {
      id: 'req-2',
      url: `${LOGIN_URL}/authenticate`,
      method: 'POST',
      status: 302,
      type: 'xhr',
      timestamp: RUN_START + 950,
      startTime: RUN_START + 950
    }
  ]
}

function failingTest(uid: string): TestStatsFragment {
  return {
    uid,
    title: 'logs in with valid credentials',
    fullTitle: 'login page logs in with valid credentials',
    file: '/specs/login.e2e.ts',
    state: 'failed',
    error: {
      name: 'AssertionError',
      message: `Expected: "${EXPECTED_FLASH}"\nReceived: "${BASELINE_FLASH}"`
    }
  } as TestStatsFragment
}

/** One root suite holding the failed test — the second source the Errors tab
 *  collects from, and the tree the compare panel windows the live run by. */
export function failingSuites(
  uid = SELECTED_TEST_UID
): Record<string, SuiteStatsFragment>[] {
  return [
    {
      'login-suite': {
        uid: 'login-suite',
        title: 'login page',
        fullTitle: 'login page',
        file: '/specs/login.e2e.ts',
        state: 'failed',
        start: new Date(RUN_START),
        end: new Date(RUN_START + 1500),
        tests: [failingTest(uid)],
        suites: []
      } as SuiteStatsFragment
    }
  ]
}

export interface WorkbenchContexts {
  commands?: CommandLog[]
  consoleLogs?: ConsoleLog[]
  networkRequests?: NetworkRequest[]
  baselines?: Map<string, PreservedAttempt>
  selectedTestUid?: string
  suites?: Record<string, SuiteStatsFragment>[]
}

export interface WorkbenchHarness {
  workbench: DevtoolsWorkbench
  /** The dock tab bar — Source/Log/Console/Network/Errors (+ Compare). */
  dock: DevtoolsTabs
  /** The left bar — Actions/Metadata. */
  sidebar: DevtoolsTabs
  /** Republish `baselineContext` the way DataManager does on a
   *  `baseline:saved` / `baseline:cleared` broadcast: always a fresh Map. */
  publishBaselines(next: Map<string, PreservedAttempt>): Promise<void>
  /** Republish `selectedTestUidContext` through the one setter DataManager
   *  exposes for it (`setSelectedTestUid`); `undefined` deselects. */
  publishSelectedTestUid(next: string | undefined): Promise<void>
  /** Await a tab-bar rebuild — it refreshes its list off `slotchange`, a task
   *  after the workbench's own render. */
  settleTabs(): Promise<void>
}

/** Keys the workbench, its bars and its drag handles persist. Cleared between
 *  tests so specs can't leak layout state into each other. */
const PERSISTED_KEYS = [
  'toolbar',
  'workbenchSidebar',
  'activeWorkbenchTab',
  'activeActionsTab',
  'toolbarHeight',
  'workbenchSidebarWidth',
  'traceTimelineHeight',
  'playerPaneHeight'
]

export const DOCK_CACHE_ID = 'activeWorkbenchTab'
export const SIDEBAR_CACHE_ID = 'activeActionsTab'

/** Mocha's root hook — declared locally, as in `support/mount.ts`. */
declare const afterEach: (teardown: () => void) => void

const mountedHosts: Element[] = []

afterEach(() => {
  for (const host of mountedHosts.splice(0)) {
    host.remove()
  }
  for (const key of PERSISTED_KEYS) {
    localStorage.removeItem(key)
  }
})

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function tabBar(workbench: DevtoolsWorkbench, cacheId: string): DevtoolsTabs {
  const bar = workbench.shadowRoot?.querySelector<DevtoolsTabs>(
    `wdio-devtools-tabs[cacheid="${cacheId}"]`
  )
  if (!bar) {
    throw new Error(`the workbench rendered no tab bar for "${cacheId}"`)
  }
  return bar
}

export function dockTabs(dock: DevtoolsTabs): DevtoolsTab[] {
  return Array.from(dock.querySelectorAll<DevtoolsTab>('wdio-devtools-tab'))
}

export const tabLabels = (bar: DevtoolsTabs): string[] =>
  dockTabs(bar).map((tab) => tab.getAttribute('label') ?? '')

export const openTabLabels = (bar: DevtoolsTabs): string[] =>
  dockTabs(bar)
    .filter((tab) => tab.hasAttribute('active'))
    .map((tab) => tab.getAttribute('label') ?? '')

/** The panel behind every open tab — an empty array is a dock showing nothing. */
export const openPanelTags = (bar: DevtoolsTabs): string[] =>
  dockTabs(bar)
    .filter((tab) => tab.hasAttribute('active'))
    .map((tab) => (tab.firstElementChild?.tagName ?? '').toLowerCase())

export function mountWorkbench(
  contexts: WorkbenchContexts = {},
  props: { playerMode?: boolean } = {}
): Promise<WorkbenchHarness> {
  const host = document.createElement('div')
  document.body.append(host)
  mountedHosts.push(host)

  // Same providers, same initial values as DataManagerController's constructor.
  const provided: [unknown, unknown][] = [
    [mutationContext, []],
    [logContext, []],
    [consoleLogContext, contexts.consoleLogs ?? []],
    [networkRequestContext, contexts.networkRequests ?? []],
    [metadataContext, undefined],
    [metadataBySessionContext, {}],
    [commandContext, contexts.commands ?? []],
    [sourceContext, undefined],
    [suiteContext, contexts.suites ?? []],
    [hasConnectionContext, true],
    [
      baselineContext,
      contexts.baselines ?? new Map<string, PreservedAttempt>()
    ],
    [selectedTestUidContext, contexts.selectedTestUid],
    [framesContext, []],
    [actionGroupsContext, undefined],
    [transcriptContext, undefined]
  ]

  const providers = new Map<
    unknown,
    ContextProvider<Context<unknown, unknown>>
  >()
  for (const [context, value] of provided) {
    const provider = new ContextProvider(host, {
      context: context as Context<unknown, unknown>,
      initialValue: value
    })
    // A plain div is no ReactiveElement, so @lit/context never fires the
    // controller's connect signal — see support/mount.ts.
    provider.hostConnected()
    providers.set(context, provider)
  }

  return finishMount(host, providers, props)
}

async function finishMount(
  host: HTMLElement,
  providers: Map<unknown, ContextProvider<Context<unknown, unknown>>>,
  props: { playerMode?: boolean }
): Promise<WorkbenchHarness> {
  const workbench = document.createElement(
    'wdio-devtools-workbench'
  ) as DevtoolsWorkbench
  if (props.playerMode) {
    workbench.playerMode = true
  }
  host.append(workbench)
  await workbench.updateComplete

  const dock = tabBar(workbench, DOCK_CACHE_ID)
  const sidebar = tabBar(workbench, SIDEBAR_CACHE_ID)

  const settleTabs = async () => {
    await nextTask()
    await workbench.updateComplete
    await dock.updateComplete
    await sidebar.updateComplete
  }
  await settleTabs()

  return {
    workbench,
    dock,
    sidebar,
    settleTabs,
    publishBaselines: async (next) => {
      providers.get(baselineContext)?.setValue(next)
      await settleTabs()
    },
    publishSelectedTestUid: async (next) => {
      providers.get(selectedTestUidContext)?.setValue(next)
      await settleTabs()
    }
  }
}
