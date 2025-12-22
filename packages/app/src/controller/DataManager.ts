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
export const isTestRunningContext = createContext<boolean>(
  Symbol('isTestRunning')
)

interface SocketMessage<
  T extends keyof TraceLog | 'testStopped' = keyof TraceLog | 'testStopped'
> {
  scope: T
  data: T extends keyof TraceLog ? TraceLog[T] : unknown
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
  clearExecutionData(uid?: string) {
    this.#resetExecutionData()
    if (uid) {
      this.#markTestAsRunning(uid)
    }
  }

  // Private method to mark a test/suite as running immediately for UI feedback
  #markTestAsRunning(uid: string) {
    const suites = this.suitesContextProvider.value || []

    // If uid is '*', mark ALL tests/suites as running
    if (uid === '*') {
      const updatedSuites = suites.map((chunk) => {
        const updatedChunk: Record<string, SuiteStatsFragment> = {}
        Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
          ([suiteUid, suite]) => {
            if (!suite) {
              updatedChunk[suiteUid] = suite
              return
            }

            const markAllAsRunning = (
              s: SuiteStatsFragment
            ): SuiteStatsFragment => {
              return {
                ...s,
                start: new Date(),
                end: undefined,
                tests:
                  s.tests?.map((test) => ({
                    ...test,
                    start: new Date(),
                    end: undefined
                  })) || [],
                suites: s.suites?.map(markAllAsRunning) || []
              }
            }

            updatedChunk[suiteUid] = markAllAsRunning(suite)
          }
        )
        return updatedChunk
      })
      this.suitesContextProvider.setValue(updatedSuites)
      this.#host.requestUpdate()
      return
    }

    // Otherwise, mark specific test/suite as running
    const updatedSuites = suites.map((chunk) => {
      const updatedChunk: Record<string, SuiteStatsFragment> = {}
      Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
        ([suiteUid, suite]) => {
          if (!suite) {
            updatedChunk[suiteUid] = suite
            return
          }

          // Recursive helper to mark tests/suites as running
          const markAsRunning = (s: SuiteStatsFragment): SuiteStatsFragment => {
            // If this is the target suite/test, mark it as running
            if (s.uid === uid) {
              return {
                ...s,
                start: new Date(),
                end: undefined, // Clear end to mark as running
                tests:
                  s.tests?.map((test) => ({
                    ...test,
                    start: new Date(),
                    end: undefined
                  })) || [],
                suites: s.suites?.map(markAsRunning) || []
              }
            }

            // Check if any child test matches
            const updatedTests = s.tests?.map((test) => {
              if (test.uid === uid) {
                return {
                  ...test,
                  start: new Date(),
                  end: undefined
                }
              }
              return test
            })

            // Recursively check nested suites
            const updatedNestedSuites = s.suites?.map(markAsRunning)

            return {
              ...s,
              tests: updatedTests || [],
              suites: updatedNestedSuites || []
            }
          }

          updatedChunk[suiteUid] = markAsRunning(suite)
        }
      )
      return updatedChunk
    })

    this.suitesContextProvider.setValue(updatedSuites)
    this.#host.requestUpdate()
  }

  hostConnected() {
    const wsUrl = `ws://${window.location.host}/client`
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

      // Handle test stopped event
      if (scope === 'testStopped') {
        this.#handleTestStopped()
        this.#host.requestUpdate()
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
      if (!chunk) {
        continue
      }

      for (const suite of Object.values(chunk)) {
        if (!suite?.start) {
          continue
        }

        const suiteStartTime =
          suite.start instanceof Date
            ? suite.start.getTime()
            : typeof suite.start === 'number'
              ? suite.start
              : 0

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

  #handleTestStopped() {
    // Mark all running tests as failed when test execution is stopped
    const suites = this.suitesContextProvider.value || []
    const updatedSuites = suites.map((chunk) => {
      const updatedChunk: Record<string, SuiteStatsFragment> = {}
      Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
        ([uid, suite]) => {
          if (!suite) {
            updatedChunk[uid] = suite
            return
          }

          // Recursive helper to update tests and nested suites
          const updateSuite = (s: SuiteStatsFragment): SuiteStatsFragment => {
            const updatedTests = s.tests?.map((test): TestStatsFragment => {
              // If test is running (no end time), mark it as failed
              if (test && !test.end) {
                return {
                  ...test,
                  end: new Date(),
                  state: 'failed' as 'failed',
                  error: {
                    message: 'Test execution stopped',
                    name: 'TestStoppedError'
                  }
                }
              }
              return test
            })

            // Recursively update nested suites (for Cucumber scenarios)
            const updatedNestedSuites = s.suites?.map(updateSuite)

            return {
              ...s,
              tests: updatedTests || [],
              suites: updatedNestedSuites || []
            }
          }

          updatedChunk[uid] = updateSuite(suite)
        }
      )
      return updatedChunk
    })

    this.suitesContextProvider.setValue(updatedSuites)
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
  }

  #handleSuitesUpdate(data: unknown) {
    const payloads = Array.isArray(data)
      ? (data as Record<string, SuiteStatsFragment>[])
      : ([data] as Record<string, SuiteStatsFragment>[])

    const suiteMap = new Map<string, SuiteStatsFragment>()

    // Populate with existing suites (keeps test list visible)
    ;(this.suitesContextProvider.value || []).forEach((chunk) => {
      Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
        ([uid, suite]) => {
          if (suite?.uid) {
            suiteMap.set(uid, suite)
          }
        }
      )
    })

    // Process incoming payloads
    payloads.forEach((chunk) => {
      if (!chunk) {
        return
      }

      Object.entries(chunk).forEach(([uid, suite]) => {
        if (!suite?.uid) {
          return
        }

        const existing = suiteMap.get(uid)

        // Always merge to preserve all tests in the suite
        suiteMap.set(uid, existing ? this.#mergeSuite(existing, suite) : suite)
      })
    })

    this.suitesContextProvider.setValue(
      Array.from(suiteMap.entries()).map(([uid, suite]) => ({ [uid]: suite }))
    )
  }

  #getTimestamp(date: Date | number | undefined): number {
    if (!date) {
      return 0
    }
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
    const mergedSuites = this.#mergeChildSuites(
      existing.suites,
      incoming.suites
    )

    // Then merge suite properties, ensuring merged tests/suites are preserved
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tests, suites, ...incomingProps } = incoming

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
      if (!suite) {
        return
      }
      const existing = map.get(suite.uid)
      map.set(suite.uid, existing ? this.#mergeSuite(existing, suite) : suite)
    })

    return Array.from(map.values())
  }

  #mergeTests(prev: TestStatsFragment[] = [], next: TestStatsFragment[] = []) {
    const map = new Map<string, TestStatsFragment>()
    prev?.forEach((test) => test && map.set(test.uid, test))

    next?.forEach((test) => {
      if (!test) {
        return
      }
      const existing = map.get(test.uid)

      // Check if this test is a rerun (different start time)
      const isRerun =
        existing &&
        test.start &&
        existing.start &&
        this.#getTimestamp(test.start) !== this.#getTimestamp(existing.start)

      // Replace on rerun, merge on normal update
      map.set(
        test.uid,
        isRerun ? test : existing ? { ...existing, ...test } : test
      )
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
