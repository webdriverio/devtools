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
  commandContext,
  sourceContext,
  suiteContext,
  hasConnectionContext,
  baselineContext,
  selectedTestUidContext
} from './context.js'
import { BASELINE_WS_SCOPE } from '@wdio/devtools-shared'
import { CACHE_ID } from './constants.js'
import { getTimestamp } from '../utils/helpers.js'
import { rerunState } from './rerunState.js'
import type {
  TestStatsFragment,
  SuiteStatsFragment,
  SocketMessage
} from './types.js'
import { canonicalizeUids, mergeSuite } from './suite-merge.js'

export class DataManagerController implements ReactiveController {
  #ws?: WebSocket
  #host: ReactiveControllerHost & HTMLElement
  #lastSeenRunTimestamp = 0
  #activeRerunTestUid?: string

  mutationsContextProvider: ContextProvider<typeof mutationContext>
  logsContextProvider: ContextProvider<typeof logContext>
  consoleLogsContextProvider: ContextProvider<typeof consoleLogContext>
  networkRequestsContextProvider: ContextProvider<typeof networkRequestContext>
  metadataContextProvider: ContextProvider<typeof metadataContext>
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
                state: 'running',
                start: new Date(),
                end: undefined,
                // Clear leaf-level tests so stale step entries from a previous
                // run don't linger when the feature file or test code changed
                // between runs (e.g. Cucumber step text edited). The new run
                // repopulates them. Child suites are preserved so the tree
                // structure remains visible during the rerun.
                tests: [] as TestStatsFragment[],
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

          // Recursive helper to mark only the targeted branch as running
          const markAsRunning = (
            s: SuiteStatsFragment
          ): { suite: SuiteStatsFragment; matched: boolean } => {
            const runStart = new Date()

            if (entryType !== 'test' && s.uid === uid) {
              const markSuiteTreeAsRunning = (
                suiteNode: SuiteStatsFragment
              ): SuiteStatsFragment => ({
                ...suiteNode,
                state: 'running',
                start: runStart,
                end: undefined,
                // Clear leaf-level tests on rerun so stale step entries from
                // a previous run can't linger. See sibling markAllAsRunning.
                tests: [] as TestStatsFragment[],
                suites: suiteNode.suites?.map(markSuiteTreeAsRunning) || []
              })

              return {
                matched: true,
                suite: markSuiteTreeAsRunning(s)
              }
            }

            let matched = false
            const updatedTests = (s.tests?.map((test) => {
              if (test.uid === uid) {
                matched = true
                return {
                  ...test,
                  state: 'pending',
                  start: new Date(),
                  end: undefined
                }
              }
              return test
            }) ?? []) as TestStatsFragment[]

            const updatedNestedSuites =
              s.suites?.map((nestedSuite) => {
                const nestedResult = markAsRunning(nestedSuite)
                if (nestedResult.matched) {
                  matched = true
                }
                return nestedResult.suite
              }) || []

            return {
              matched,
              suite: {
                ...s,
                ...(matched
                  ? {
                      state: 'running' as const,
                      // Don't reset the parent's start/end when it is already
                      // running — subsequent child-scenario marks would otherwise
                      // reset the feature's original run timestamp.
                      ...(s.state !== 'running'
                        ? { start: runStart, end: undefined }
                        : {})
                    }
                  : {}),
                tests: updatedTests || [],
                suites: updatedNestedSuites
              }
            }
          }

          updatedChunk[suiteUid] = markAsRunning(suite).suite
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

      if (scope === 'testStopped') {
        this.#handleTestStopped()
        this.#host.requestUpdate()
        return
      }

      if (scope === 'screencast') {
        const { sessionId } = data as { sessionId: string }
        window.dispatchEvent(
          new CustomEvent('screencast-ready', { detail: { sessionId } })
        )
        return
      }

      if (scope === 'clearExecutionData') {
        const { uid, entryType, clearSuiteTree } =
          data as SocketMessage<'clearExecutionData'>['data']
        this.clearExecutionData(uid, entryType)
        if (clearSuiteTree) {
          this.suitesContextProvider.setValue([])
          this.#activeRerunTestUid = undefined
          rerunState.activeRerunSuiteUid = undefined
          this.#lastSeenRunTimestamp = 0
        }
        this.#host.requestUpdate()
        return
      }

      if (scope === 'replaceCommand') {
        const { oldTimestamp, command } =
          data as SocketMessage<'replaceCommand'>['data']
        this.#handleReplaceCommand(oldTimestamp, command)
        this.#host.requestUpdate()
        return
      }

      if (scope === BASELINE_WS_SCOPE.saved) {
        const { testUid, attempt } = data as SocketMessage<
          typeof BASELINE_WS_SCOPE.saved
        >['data']
        this.#handleBaselineSaved(testUid, attempt)
        this.#host.requestUpdate()
        return
      }

      if (scope === BASELINE_WS_SCOPE.cleared) {
        const { testUid } = data as SocketMessage<
          typeof BASELINE_WS_SCOPE.cleared
        >['data']
        this.#handleBaselineCleared(testUid)
        this.#host.requestUpdate()
        return
      }

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

      this.#host.requestUpdate()
    } catch (e: unknown) {
      console.warn(`Failed to parse socket message: ${(e as Error).message}`)
    }
  }

  #shouldResetForNewRun(data: unknown): boolean {
    // During a UI-triggered rerun, suppress auto-detection so sibling-scenario
    // updates don't wipe accumulated execution data.
    // Still update #lastSeenRunTimestamp so that once activeRerunSuiteUid is
    // cleared the final suite update isn't mistakenly treated as a new run.
    if (rerunState.activeRerunSuiteUid) {
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
          const t = getTimestamp(
            suite.start as Date | number | string | undefined
          )
          if (t > this.#lastSeenRunTimestamp) {
            this.#lastSeenRunTimestamp = t
          }
        }
      }
      return false
    }

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

        const suiteStartTime = getTimestamp(
          suite.start as Date | number | string | undefined
        )

        if (suiteStartTime <= 0) {
          continue
        }

        // New run detected if we see a newer start timestamp.
        // Exception: if the existing suite for this uid has no end time, it is
        // still an ongoing run (e.g. a Cucumber feature spanning multiple
        // scenarios) — treat it as a continuation, not a new run.
        if (suiteStartTime > this.#lastSeenRunTimestamp) {
          const existingChunks = this.suitesContextProvider.value || []
          let existingEnd: unknown = undefined
          outer: for (const ec of existingChunks) {
            for (const [uid, existing] of Object.entries(ec)) {
              if (uid === Object.keys(chunk)[0]) {
                existingEnd = existing?.end
                break outer
              }
            }
          }
          // Only reset if the previous run was already finished (had an end time).
          // An ongoing run (end == null / undefined) is just a continuation.
          const previousRunFinished =
            existingEnd !== null && existingEnd !== undefined
          if (previousRunFinished) {
            this.#lastSeenRunTimestamp = suiteStartTime
            return true
          }
          // Continuation — update tracking timestamp but do NOT reset
          this.#lastSeenRunTimestamp = suiteStartTime
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
    this.networkRequestsContextProvider.setValue([])

    // Keep suitesContextProvider intact - test list stays visible
    // Keep metadata and sources - they're environment-level

    // Force synchronous re-render
    this.#host.requestUpdate()
  }

  #handleTestStopped() {
    this.#activeRerunTestUid = undefined
    rerunState.activeRerunSuiteUid = undefined

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
                  state: 'failed',
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

            // Derive the suite's own state from its updated children so that
            // STATE_MAP['running'] no longer produces a spinner after stop.
            const allTests = [
              ...(updatedTests || []),
              ...(updatedNestedSuites || [])
            ]
            const hasFailed = allTests.some((t) => t?.state === 'failed')
            const hasRunning = allTests.some((t) => !t?.end)
            const derivedState: SuiteStatsFragment['state'] = hasRunning
              ? s.state
              : hasFailed
                ? 'failed'
                : s.state === 'running'
                  ? 'failed'
                  : s.state

            return {
              ...s,
              state: derivedState,
              ...(!hasRunning && !s.end ? { end: new Date() } : {}),

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

  #handleReplaceCommand(oldTimestamp: number, newCommand: CommandLog) {
    const current = this.commandsContextProvider.value || []
    // Prefer stable `id` — chained selenium calls share a millisecond.
    let idx = -1
    const newId = (newCommand as CommandLog & { id?: number }).id
    if (typeof newId === 'number') {
      idx = current.findIndex(
        (c) => (c as CommandLog & { id?: number }).id === newId
      )
    }
    if (idx === -1) {
      idx = current.map((c) => c.timestamp).lastIndexOf(oldTimestamp)
    }
    if (idx !== -1) {
      const updated = [...current]
      updated[idx] = newCommand
      this.commandsContextProvider.setValue(updated)
    } else {
      this.commandsContextProvider.setValue([...current, newCommand])
    }
  }

  #handleConsoleLogsUpdate(data: string[]) {
    this.consoleLogsContextProvider.setValue([
      ...(this.consoleLogsContextProvider.value || []),
      ...data
    ])
  }

  #handleNetworkRequestsUpdate(data: NetworkRequest[]) {
    const current = this.networkRequestsContextProvider.value || []
    const byId = new Map<string, number>()
    current.forEach((r, i) => {
      if (r?.id) {
        byId.set(r.id, i)
      }
    })
    const next = [...current]
    for (const incoming of data) {
      if (!incoming?.id) {
        next.push(incoming)
        continue
      }
      const existingIdx = byId.get(incoming.id)
      if (existingIdx !== undefined) {
        next[existingIdx] = incoming
      } else {
        byId.set(incoming.id, next.length)
        next.push(incoming)
      }
    }
    this.networkRequestsContextProvider.setValue(next)
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

    // Canonicalize uids for root suites so a rerun whose reporter assigned a
    // different uid still merges into the original row.
    const existingRootSuites = Array.from(suiteMap.values())
    const incomingRootSuites: SuiteStatsFragment[] = []
    payloads.forEach((chunk) => {
      if (!chunk) {
        return
      }
      for (const suite of Object.values(chunk)) {
        if (suite?.uid) {
          incomingRootSuites.push(suite)
        }
      }
    })
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
    this.commandsContextProvider.setValue(traceFile.commands)
    this.sourcesContextProvider.setValue(traceFile.sources)
    this.suitesContextProvider.setValue(
      (traceFile.suites || []) as Record<string, SuiteStatsFragment>[]
    )
  }
}
