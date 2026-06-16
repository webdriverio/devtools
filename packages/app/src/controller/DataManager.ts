import { ContextProvider } from '@lit/context'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import type {
  Metadata,
  CommandLog,
  TraceLog,
  PreservedAttempt
} from '@wdio/devtools-shared'

import {
  mutationContext,
  logContext,
  consoleLogContext,
  networkRequestContext,
  metadataContext,
  metadataBySessionContext,
  commandContext,
  sourceContext,
  suiteContext,
  hasConnectionContext,
  baselineContext,
  selectedTestUidContext
} from './context.js'
import { BASELINE_WS_SCOPE, WS_SCOPE } from '@wdio/devtools-shared'
import { CACHE_ID } from './constants.js'
import { rerunState } from './rerunState.js'
import type { SuiteStatsFragment, SocketMessage } from './types.js'
import { canonicalizeUids, mergeSuite } from './suite-merge.js'
import {
  markAllRunning,
  markSpecificRunning,
  markRunningAsStopped
} from './mark-running.js'
import { shouldResetForNewRun } from './run-detection.js'
import {
  mergeNetworkRequests,
  replaceCommand,
  mergeSessionMetadata
} from './contextUpdates.js'

export class DataManagerController implements ReactiveController {
  #ws?: WebSocket
  #host: ReactiveControllerHost & HTMLElement
  #lastSeenRunTimestamp = 0
  #activeRerunTestUid?: string
  /** Most-recently-seen browser sessionId — target for metadata messages
   *  that arrive without their own sessionId (e.g. url updates). */
  #currentSessionId?: string

  mutationsContextProvider: ContextProvider<typeof mutationContext>
  logsContextProvider: ContextProvider<typeof logContext>
  consoleLogsContextProvider: ContextProvider<typeof consoleLogContext>
  networkRequestsContextProvider: ContextProvider<typeof networkRequestContext>
  metadataContextProvider: ContextProvider<typeof metadataContext>
  metadataBySessionContextProvider: ContextProvider<
    typeof metadataBySessionContext
  >
  commandsContextProvider: ContextProvider<typeof commandContext>
  sourcesContextProvider: ContextProvider<typeof sourceContext>
  suitesContextProvider: ContextProvider<typeof suiteContext>
  hasConnectionProvider: ContextProvider<typeof hasConnectionContext>
  baselineContextProvider: ContextProvider<typeof baselineContext>
  selectedTestUidContextProvider: ContextProvider<typeof selectedTestUidContext>

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
    this.networkRequestsContextProvider = new ContextProvider(this.#host, {
      context: networkRequestContext,
      initialValue: []
    })
    this.metadataContextProvider = new ContextProvider(this.#host, {
      context: metadataContext
    })
    this.metadataBySessionContextProvider = new ContextProvider(this.#host, {
      context: metadataBySessionContext,
      initialValue: {}
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
      context: hasConnectionContext,
      initialValue: false
    })
    this.baselineContextProvider = new ContextProvider(this.#host, {
      context: baselineContext,
      initialValue: new Map<string, PreservedAttempt>()
    })
    this.selectedTestUidContextProvider = new ContextProvider(this.#host, {
      context: selectedTestUidContext,
      initialValue: undefined
    })
  }

  setSelectedTestUid(uid: string | undefined) {
    this.selectedTestUidContextProvider.setValue(uid)
  }

  #handleBaselineSaved(testUid: string, attempt: PreservedAttempt) {
    const next = new Map(this.baselineContextProvider.value || new Map())
    next.set(testUid, attempt)
    this.baselineContextProvider.setValue(next)
    // Auto-select the preserved test so the Compare tab can find the pair.
    this.selectedTestUidContextProvider.setValue(testUid)
  }

  #handleBaselineCleared(testUid: string) {
    const next = new Map(this.baselineContextProvider.value || new Map())
    next.delete(testUid)
    this.baselineContextProvider.setValue(next)
  }

  get hasConnection() {
    return this.hasConnectionProvider.value
  }

  get traceType() {
    return this.metadataContextProvider.value?.type
  }

  clearExecutionData(uid?: string, entryType?: 'suite' | 'test') {
    // If we are already tracking a feature-level rerun and this clear is for
    // a child scenario (not the top-level rerun trigger itself), skip resetting
    // execution data so previously-completed scenarios' data is preserved.
    const isChildOfActiveRerun = !!(
      uid &&
      rerunState.activeRerunSuiteUid &&
      uid !== rerunState.activeRerunSuiteUid
    )

    if (!isChildOfActiveRerun) {
      this.#resetExecutionData()
    }

    // When the backend sends clearExecutionData with no uid (e.g. a full Nightwatch
    // rerun), immediately mark all suites as running so the spinner shows instead
    // of the previous run's terminal state (passed/failed).
    if (!uid) {
      rerunState.activeRerunSuiteUid = undefined
      this.#markTestAsRunning('*', 'suite')
      return
    }

    // Track the top-level rerun suite uid so we can identify child-scenario
    // clears (from the Nightwatch backend) and skip their data wipes.
    if (!isChildOfActiveRerun && entryType === 'suite' && uid !== '*') {
      rerunState.activeRerunSuiteUid = uid
    }

    // Track explicit single-test reruns so merge logic can keep sibling tests
    // stable while the backend emits suite-level "pending" snapshots.
    if (entryType === 'test' && uid !== '*') {
      this.#activeRerunTestUid = uid
    } else if (entryType === 'suite' || uid === '*') {
      this.#activeRerunTestUid = undefined
    }

    if (uid) {
      this.#markTestAsRunning(uid, entryType)
    }
  }

  #markTestAsRunning(uid: string, entryType?: 'suite' | 'test') {
    const suites = this.suitesContextProvider.value || []
    const updated =
      uid === '*'
        ? markAllRunning(suites)
        : markSpecificRunning(suites, uid, entryType)
    this.suitesContextProvider.setValue(updated)
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

  #handleClearExecutionScope(data: unknown): void {
    const { uid, entryType, clearSuiteTree } =
      data as SocketMessage<'clearExecutionData'>['data']
    this.clearExecutionData(uid, entryType)
    if (clearSuiteTree) {
      this.suitesContextProvider.setValue([])
      this.#activeRerunTestUid = undefined
      rerunState.activeRerunSuiteUid = undefined
      this.#lastSeenRunTimestamp = 0
    }
  }

  // Returns true if the control scope was fully handled and the regular
  // dispatch should be skipped. Caller is responsible for requestUpdate().
  #handleControlScope(scope: string, data: unknown): boolean {
    if (scope === WS_SCOPE.testStopped) {
      this.#handleTestStopped()
      return true
    }
    if (scope === 'screencast') {
      const { sessionId, startTime, duration } = data as {
        sessionId: string
        startTime?: number
        duration?: number
      }
      window.dispatchEvent(
        new CustomEvent('screencast-ready', {
          detail: { sessionId, startTime, duration }
        })
      )
      return true
    }
    if (scope === WS_SCOPE.clearExecutionData) {
      this.#handleClearExecutionScope(data)
      return true
    }
    if (scope === WS_SCOPE.replaceCommand) {
      const { oldTimestamp, command } =
        data as SocketMessage<'replaceCommand'>['data']
      this.#handleReplaceCommand(oldTimestamp, command)
      return true
    }
    if (scope === BASELINE_WS_SCOPE.saved) {
      const { testUid, attempt } = data as SocketMessage<
        typeof BASELINE_WS_SCOPE.saved
      >['data']
      this.#handleBaselineSaved(testUid, attempt)
      return true
    }
    if (scope === BASELINE_WS_SCOPE.cleared) {
      const { testUid } = data as SocketMessage<
        typeof BASELINE_WS_SCOPE.cleared
      >['data']
      this.#handleBaselineCleared(testUid)
      return true
    }
    return false
  }

  #dispatchDataScope(scope: string, data: unknown): void {
    if (scope === 'mutations') {
      this.#handleMutationsUpdate(data as TraceMutation[])
    } else if (scope === 'logs') {
      this.#handleLogsUpdate(data as string[])
    } else if (scope === 'commands') {
      this.#handleCommandsUpdate(data as CommandLog[])
    } else if (scope === 'metadata') {
      this.#handleMetadataUpdate(data as Metadata)
    } else if (scope === 'consoleLogs') {
      this.#handleConsoleLogsUpdate(data as string[])
    } else if (scope === 'networkRequests') {
      this.#handleNetworkRequestsUpdate(data as NetworkRequest[])
    } else if (scope === 'sources') {
      this.#handleSourcesUpdate(data as Record<string, string>)
    } else if (scope === 'suites') {
      if (this.#shouldResetForNewRun(data)) {
        this.#resetExecutionData()
      }
      this.#handleSuitesUpdate(data)
    }
  }

  #handleSocketMessage(event: MessageEvent) {
    try {
      const { scope, data } = JSON.parse(event.data) as SocketMessage
      if (!data) {
        return
      }
      if (this.#handleControlScope(scope, data)) {
        this.#host.requestUpdate()
        return
      }
      this.#dispatchDataScope(scope, data)
      this.#host.requestUpdate()
    } catch (e: unknown) {
      console.warn(`Failed to parse socket message: ${(e as Error).message}`)
    }
  }

  #shouldResetForNewRun(data: unknown): boolean {
    const { shouldReset, newLastSeenTimestamp } = shouldResetForNewRun(
      data,
      {
        lastSeenRunTimestamp: this.#lastSeenRunTimestamp,
        activeRerunSuiteUid: rerunState.activeRerunSuiteUid
      },
      this.suitesContextProvider.value || []
    )
    this.#lastSeenRunTimestamp = newLastSeenTimestamp
    return shouldReset
  }

  #resetExecutionData() {
    // Clear ONLY execution visualization data
    this.mutationsContextProvider.setValue([])
    this.commandsContextProvider.setValue([])
    this.logsContextProvider.setValue([])
    this.consoleLogsContextProvider.setValue([])
    this.networkRequestsContextProvider.setValue([])

    // Keep suitesContextProvider intact - test list stays visible
    // Keep metadata and sources - they're environment-level

    // Force synchronous re-render
    this.#host.requestUpdate()
  }

  #handleTestStopped() {
    this.#activeRerunTestUid = undefined
    rerunState.activeRerunSuiteUid = undefined
    const suites = this.suitesContextProvider.value || []
    this.suitesContextProvider.setValue(markRunningAsStopped(suites))
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

  #handleReplaceCommand(oldTimestamp: number, newCommand: CommandLog) {
    this.commandsContextProvider.setValue(
      replaceCommand(
        this.commandsContextProvider.value || [],
        oldTimestamp,
        newCommand
      )
    )
  }

  #handleConsoleLogsUpdate(data: string[]) {
    this.consoleLogsContextProvider.setValue([
      ...(this.consoleLogsContextProvider.value || []),
      ...data
    ])
  }

  #handleNetworkRequestsUpdate(data: NetworkRequest[]) {
    this.networkRequestsContextProvider.setValue(
      mergeNetworkRequests(
        this.networkRequestsContextProvider.value || [],
        data
      )
    )
  }

  #handleMetadataUpdate(data: Metadata) {
    const { bySession, currentSessionId, active } = mergeSessionMetadata(
      {
        bySession: this.metadataBySessionContextProvider.value || {},
        currentSessionId: this.#currentSessionId
      },
      data
    )
    this.#currentSessionId = currentSessionId
    this.metadataBySessionContextProvider.setValue(bySession)
    this.metadataContextProvider.setValue(active)
  }

  #handleSourcesUpdate(data: Record<string, string>) {
    const merged = {
      ...(this.sourcesContextProvider.value || {}),
      ...data
    }
    this.sourcesContextProvider.setValue(merged)
  }

  #seedSuiteMapFromContext(): Map<string, SuiteStatsFragment> {
    const suiteMap = new Map<string, SuiteStatsFragment>()
    ;(this.suitesContextProvider.value || []).forEach((chunk) => {
      Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
        ([uid, suite]) => {
          if (suite?.uid) {
            suiteMap.set(uid, suite)
          }
        }
      )
    })
    return suiteMap
  }

  #collectIncomingRootSuites(
    payloads: Record<string, SuiteStatsFragment>[]
  ): SuiteStatsFragment[] {
    const out: SuiteStatsFragment[] = []
    payloads.forEach((chunk) => {
      if (!chunk) {
        return
      }
      for (const suite of Object.values(chunk)) {
        if (suite?.uid) {
          out.push(suite)
        }
      }
    })
    return out
  }

  #handleSuitesUpdate(data: unknown) {
    const payloads = Array.isArray(data)
      ? (data as Record<string, SuiteStatsFragment>[])
      : ([data] as Record<string, SuiteStatsFragment>[])
    const suiteMap = this.#seedSuiteMapFromContext()
    // Canonicalize uids for root suites so a rerun whose reporter assigned a
    // different uid still merges into the original row.
    const existingRootSuites = Array.from(suiteMap.values())
    const incomingRootSuites = this.#collectIncomingRootSuites(payloads)
    const mergeCtx = {
      activeRerunTestUid: this.#activeRerunTestUid,
      activeRerunSuiteUid: rerunState.activeRerunSuiteUid
    }
    const canonicalizedRoots = canonicalizeUids(
      existingRootSuites,
      incomingRootSuites
    )
    canonicalizedRoots.forEach((suite) => {
      if (!suite?.uid) {
        return
      }
      const existing = suiteMap.get(suite.uid)
      const merged = existing ? mergeSuite(existing, suite, mergeCtx) : suite
      suiteMap.set(suite.uid, merged)
    })
    this.suitesContextProvider.setValue(
      Array.from(suiteMap.entries()).map(([uid, suite]) => ({ [uid]: suite }))
    )

    // Once the active rerun suite reaches a terminal state, clear the tracking
    // flag so subsequent CLI-triggered runs can be detected normally.
    if (rerunState.activeRerunSuiteUid) {
      const activeSuite = suiteMap.get(rerunState.activeRerunSuiteUid)
      if (activeSuite?.end) {
        rerunState.activeRerunSuiteUid = undefined
      }
    }
  }

  #handleLogsUpdate(data: string[]) {
    this.logsContextProvider.setValue(data)
  }

  loadTraceFile(traceFile: TraceLog) {
    localStorage.setItem(CACHE_ID, JSON.stringify(traceFile))
    this.mutationsContextProvider.setValue(
      traceFile.mutations as TraceMutation[]
    )
    this.logsContextProvider.setValue(traceFile.logs)
    this.consoleLogsContextProvider.setValue(traceFile.consoleLogs)
    this.networkRequestsContextProvider.setValue(
      traceFile.networkRequests || []
    )
    this.metadataContextProvider.setValue(traceFile.metadata)
    // Trace files hold a single session; seed the per-session map so the
    // Metadata tab shows it (keyed by sessionId when present).
    const traceSessionId = traceFile.metadata?.sessionId
    this.metadataBySessionContextProvider.setValue(
      traceSessionId ? { [traceSessionId]: traceFile.metadata } : {}
    )
    this.#currentSessionId = traceSessionId
    this.commandsContextProvider.setValue(traceFile.commands)
    this.sourcesContextProvider.setValue(traceFile.sources)
    this.suitesContextProvider.setValue(
      (traceFile.suites || []) as Record<string, SuiteStatsFragment>[]
    )
  }
}
