import { createContext, ContextProvider } from '@lit/context'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import type {
  Metadata,
  CommandLog,
  TraceLog
} from '@wdio/devtools-service/types'
import type { SuiteStats, TestStats } from '@wdio/reporter'

const CACHE_ID = 'wdio-trace-cache'

type TestStatsFragment = Omit<Partial<TestStats>, 'uid'> & { uid: string }

type SuiteStatsFragment = Omit<
  Partial<SuiteStats>,
  'uid' | 'tests' | 'suites'
> & {
  uid: string
  tests?: TestStatsFragment[]
  suites?: SuiteStatsFragment[]
}

export const mutationContext = createContext<TraceMutation[]>(
  Symbol('mutationContext')
)
export const logContext = createContext<string[]>(Symbol('logContext'))
export const consoleLogContext = createContext<ConsoleLogs[]>(
  Symbol('consoleLogContext')
)
export const metadataContext = createContext<Metadata>(
  Symbol('metadataContext')
)
export const commandContext = createContext<CommandLog[]>(
  Symbol('commandContext')
)
export const sourceContext = createContext<Record<string, string>>(
  Symbol('sourceContext')
)
export const suiteContext = createContext<Record<string, any>[]>(
  Symbol('suiteContext')
)

const hasConnection = createContext<boolean>(Symbol('hasConnection'))

interface SocketMessage<T extends keyof TraceLog = keyof TraceLog> {
  scope: T
  data: TraceLog[T]
}

export class DataManagerController implements ReactiveController {
  #ws?: WebSocket
  #host: ReactiveControllerHost & HTMLElement
  #lastSeenRunTimestamp = 0

  mutationsContextProvider: ContextProvider<typeof mutationContext>
  logsContextProvider: ContextProvider<typeof logContext>
  consoleLogsContextProvider: ContextProvider<typeof consoleLogContext>
  metadataContextProvider: ContextProvider<typeof metadataContext>
  commandsContextProvider: ContextProvider<typeof commandContext>
  sourcesContextProvider: ContextProvider<typeof sourceContext>
  suitesContextProvider: ContextProvider<typeof suiteContext>
  hasConnectionProvider: ContextProvider<typeof hasConnection>

  constructor(host: ReactiveControllerHost & HTMLElement) {
    ;(this.#host = host).addController(this)
    this.mutationsContextProvider = new ContextProvider(this.#host, {
      context: mutationContext,
      initialValue: []
    })
    this.logsContextProvider = new ContextProvider(this.#host, {
      context: logContext,
      initialValue: []
    })
    this.consoleLogsContextProvider = new ContextProvider(this.#host, {
      context: consoleLogContext,
      initialValue: []
    })
    this.metadataContextProvider = new ContextProvider(this.#host, {
      context: metadataContext
    })
    this.commandsContextProvider = new ContextProvider(this.#host, {
      context: commandContext,
      initialValue: []
    })
    this.sourcesContextProvider = new ContextProvider(this.#host, {
      context: sourceContext
    })
    this.suitesContextProvider = new ContextProvider(this.#host, {
      context: suiteContext
    })
    this.hasConnectionProvider = new ContextProvider(this.#host, {
      context: hasConnection,
      initialValue: false
    })
  }

  get hasConnection() {
    return this.hasConnectionProvider.value
  }

  get traceType() {
    return this.metadataContextProvider.value?.type
  }

  // Public method to clear execution data when rerun is triggered
  clearExecutionData() {
    this.mutationsContextProvider.setValue([])
    this.commandsContextProvider.setValue([])
    this.logsContextProvider.setValue([])
    this.consoleLogsContextProvider.setValue([])
    this.#host.requestUpdate()
  }

  hostConnected() {
    const wsUrl = `ws://${window.location.host}/client`
    console.log(`Connecting to ${wsUrl}`)
    const ws = (this.#ws = new WebSocket(wsUrl))

    ws.addEventListener('open', () => {
      this.hasConnectionProvider.setValue(true)
      ws.addEventListener('message', this.#handleSocketMessage.bind(this))
      return this.#host.requestUpdate()
    })

    ws.addEventListener('error', () => {
      try {
        const localStorageValue = JSON.parse(
          localStorage.getItem(CACHE_ID) || ''
        ) as TraceLog
        this.loadTraceFile(localStorageValue)
      } catch (e: unknown) {
        console.warn(
          `Failed to parse cached trace file: ${(e as Error).message}`
        )
      }
    })
  }

  hostDisconnected() {
    if (this.#ws) {
      this.#ws.close()
      this.#ws = undefined
    }
  }

  #handleSocketMessage(event: MessageEvent) {
    try {
      const { scope, data } = JSON.parse(event.data) as SocketMessage
      if (!data) {
        return
      }

      // Check for new run BEFORE processing suites data
      if (scope === 'suites') {
        const shouldReset = this.#shouldResetForNewRun(data)
        if (shouldReset) {
          this.#resetExecutionData()
        }
      }

      // Route data to appropriate handler
      if (scope === 'mutations') {
        this.#handleMutationsUpdate(data as TraceMutation[])
      } else if (scope === 'commands') {
        this.#handleCommandsUpdate(data as CommandLog[])
      } else if (scope === 'metadata') {
        this.#handleMetadataUpdate(data as Metadata)
      } else if (scope === 'consoleLogs') {
        this.#handleConsoleLogsUpdate(data as string[])
      } else if (scope === 'sources') {
        this.#handleSourcesUpdate(data as Record<string, string>)
      } else if (scope === 'suites') {
        this.#handleSuitesUpdate(data)
      } else {
        this.#handleGenericUpdate(scope, data)
      }

      this.#host.requestUpdate()
    } catch (e: unknown) {
      console.warn(`Failed to parse socket message: ${(e as Error).message}`)
    }
  }

  #shouldResetForNewRun(data: unknown): boolean {
    const payloads = Array.isArray(data)
      ? (data as Record<string, SuiteStatsFragment>[])
      : ([data] as Record<string, SuiteStatsFragment>[])

    for (const chunk of payloads) {
      if (!chunk) continue

      for (const suite of Object.values(chunk)) {
        if (!suite?.start) continue

        const suiteStartTime = suite.start instanceof Date
          ? suite.start.getTime()
          : (typeof suite.start === 'number' ? suite.start : 0)

        // New run detected if we see a newer start timestamp
        if (suiteStartTime > this.#lastSeenRunTimestamp) {
          this.#lastSeenRunTimestamp = suiteStartTime
          return true
        }
      }
    }
    return false
  }

  #resetExecutionData() {
    // Clear ONLY execution visualization data
    this.mutationsContextProvider.setValue([])
    this.commandsContextProvider.setValue([])
    this.logsContextProvider.setValue([])
    this.consoleLogsContextProvider.setValue([])

    // Keep suitesContextProvider intact - test list stays visible
    // Keep metadata and sources - they're environment-level

    // Force synchronous re-render
    this.#host.requestUpdate()
  }

  #handleMutationsUpdate(data: TraceMutation[]) {
    this.mutationsContextProvider.setValue([
      ...(this.mutationsContextProvider.value || []),
      ...data
    ])
  }

  #handleCommandsUpdate(data: CommandLog[]) {
    this.commandsContextProvider.setValue([
      ...(this.commandsContextProvider.value || []),
      ...data
    ])
  }

  #handleConsoleLogsUpdate(data: string[]) {
    this.consoleLogsContextProvider.setValue([
      ...(this.consoleLogsContextProvider.value || []),
      ...data
    ])
  }

  #handleMetadataUpdate(data: Metadata) {
    this.metadataContextProvider.setValue({
      ...this.metadataContextProvider.value,
      ...data
    })
  }

  #handleSourcesUpdate(data: Record<string, string>) {
    const merged = {
      ...(this.sourcesContextProvider.value || {}),
      ...data
    }
    this.sourcesContextProvider.setValue(merged)
    console.debug('Merged sources keys', Object.keys(merged))
  }

  #handleSuitesUpdate(data: unknown) {
    const payloads = Array.isArray(data)
      ? (data as Record<string, SuiteStatsFragment>[])
      : ([data] as Record<string, SuiteStatsFragment>[])

    const suiteMap = new Map<string, SuiteStatsFragment>()

    console.log('[DataManager] Suites update - existing suites:', this.suitesContextProvider.value?.length || 0)

    // Populate with existing suites (keeps test list visible)
    ;(this.suitesContextProvider.value || []).forEach((chunk) => {
      Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
        ([uid, suite]) => {
          if (suite?.uid) {
            suiteMap.set(uid, suite)
            console.log('[DataManager] Added existing suite to map:', uid, suite.title)
          }
        }
      )
    })

    console.log('[DataManager] Incoming payloads:', payloads.length)

    // Process incoming payloads
    payloads.forEach((chunk) => {
      if (!chunk) return

      Object.entries(chunk).forEach(([uid, suite]) => {
        if (!suite?.uid) return

        console.log('[DataManager] Processing incoming suite:', uid, suite.title)
        const existing = suiteMap.get(uid)

        // Always merge to preserve all tests in the suite
        suiteMap.set(uid, existing ? this.#mergeSuite(existing, suite) : suite)
      })
    })

    console.log('[DataManager] Final suite map size:', suiteMap.size)

    this.suitesContextProvider.setValue(
      Array.from(suiteMap.entries()).map(([uid, suite]) => ({ [uid]: suite }))
    )
  }

  #getTimestamp(date: Date | number | undefined): number {
    if (!date) return 0
    return date instanceof Date ? date.getTime() : date
  }

  #handleGenericUpdate(scope: keyof TraceLog, data: any) {
    const providerMap = {
      mutations: this.mutationsContextProvider,
      logs: this.logsContextProvider,
      consoleLogs: this.consoleLogsContextProvider,
      metadata: this.metadataContextProvider,
      commands: this.commandsContextProvider,
      sources: this.sourcesContextProvider,
      suites: this.suitesContextProvider
    } as const

    const provider = providerMap[scope as keyof typeof providerMap]
    if (provider) {
      provider.setValue(data)
    }
  }

  #mergeSuite(existing: SuiteStatsFragment, incoming: SuiteStatsFragment) {
    // Note: Rerun detection and clearing is now handled in #handleSuitesUpdate
    // before any merges happen, so data is cleared proactively

    // First merge tests and suites properly
    const mergedTests = this.#mergeTests(existing.tests, incoming.tests)
    const mergedSuites = this.#mergeChildSuites(existing.suites, incoming.suites)

    // Then merge suite properties, ensuring merged tests/suites are preserved
    const { tests: _incomingTests, suites: _incomingSuites, ...incomingProps } = incoming

    return {
      ...existing,
      ...incomingProps,
      tests: mergedTests,
      suites: mergedSuites
    }
  }

  #mergeChildSuites(
    prev: SuiteStatsFragment[] = [],
    next: SuiteStatsFragment[] = []
  ) {
    const map = new Map<string, SuiteStatsFragment>()
    prev?.forEach((suite) => suite && map.set(suite.uid, suite))

    next?.forEach((suite) => {
      if (!suite) return
      const existing = map.get(suite.uid)
      map.set(suite.uid, existing ? this.#mergeSuite(existing, suite) : suite)
    })

    return Array.from(map.values())
  }

  #mergeTests(
    prev: TestStatsFragment[] = [],
    next: TestStatsFragment[] = []
  ) {
    const map = new Map<string, TestStatsFragment>()
    prev?.forEach((test) => test && map.set(test.uid, test))

    next?.forEach((test) => {
      if (!test) return
      const existing = map.get(test.uid)

      // Check if this test is a rerun (different start time)
      const isRerun =
        existing &&
        test.start &&
        existing.start &&
        this.#getTimestamp(test.start) !== this.#getTimestamp(existing.start)

      // Replace on rerun, merge on normal update
      map.set(test.uid, isRerun ? test : existing ? { ...existing, ...test } : test)
    })

    return Array.from(map.values())
  }

  loadTraceFile(traceFile: TraceLog) {
    localStorage.setItem(CACHE_ID, JSON.stringify(traceFile))
    this.mutationsContextProvider.setValue(traceFile.mutations)
    this.logsContextProvider.setValue(traceFile.logs)
    this.consoleLogsContextProvider.setValue(traceFile.consoleLogs)
    this.metadataContextProvider.setValue(traceFile.metadata)
    this.commandsContextProvider.setValue(traceFile.commands)
    this.sourcesContextProvider.setValue(traceFile.sources)
    this.suitesContextProvider.setValue(traceFile.suites || [])
  }
}

/**
 * re-export types used for context
 */
export { type Metadata, type CommandLog, type TraceLog, type TraceMutation }
