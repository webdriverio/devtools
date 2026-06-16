/**
 * In-memory baseline store for "Preserve & Rerun". Tees worker WS frames
 * into an accumulator, then time-window-filters per test/suite on demand.
 */
import logger from '@wdio/logger'

import type {
  ActiveRun,
  CommandLogLike,
  ConsoleLogLike,
  MutationLike,
  NetworkRequestLike,
  NodeError,
  NodeState,
  PreservedAttempt,
  PreservedStep,
  TimeWindowNode
} from './baseline/types.js'
import { freshRun, toMs, pickMin, pickMax } from './baseline/utils.js'
import { commandsForNode } from './baseline/command-attribution.js'

export type { PreservedAttempt, PreservedStep } from './baseline/types.js'

const log = logger('@wdio/devtools-baseline')

class BaselineStore {
  #activeRun: ActiveRun = freshRun()
  #baselines = new Map<string, PreservedAttempt>()

  resetActiveRun() {
    log.debug('resetting activeRun')
    this.#activeRun = freshRun()
  }

  recordEvent(scope: string, data: unknown) {
    if (!data) {
      return
    }
    switch (scope) {
      case 'commands':
        if (Array.isArray(data)) {
          this.#activeRun.commands.push(...(data as CommandLogLike[]))
        }
        return
      case 'replaceCommand': {
        // A command is sent first, then re-sent with late-attached fields
        // (e.g. a per-command screenshot). Apply the replacement so preserved
        // baselines carry those fields instead of the initial bare command.
        const payload = data as {
          oldTimestamp?: number
          command?: CommandLogLike
        }
        if (payload?.command) {
          this.#replaceCommand(payload.oldTimestamp, payload.command)
        }
        return
      }
      case 'consoleLogs':
        if (Array.isArray(data)) {
          this.#activeRun.consoleLogs.push(...(data as ConsoleLogLike[]))
        }
        return
      case 'networkRequests':
        if (Array.isArray(data)) {
          this.#mergeNetwork(data as NetworkRequestLike[])
        }
        return
      case 'mutations':
        if (Array.isArray(data)) {
          this.#activeRun.mutations.push(...(data as MutationLike[]))
        }
        return
      case 'sources':
        Object.assign(this.#activeRun.sources, data as Record<string, string>)
        return
      case 'suites':
        this.#ingestSuites(data)
        return
    }
  }

  // Mirrors the app's command replacement: match by stable `id`, then by the
  // old timestamp, appending only when neither locates the original.
  #replaceCommand(oldTimestamp: number | undefined, command: CommandLogLike) {
    const cmds = this.#activeRun.commands
    const newId = (command as { id?: number }).id
    let idx = -1
    if (typeof newId === 'number') {
      idx = cmds.findIndex((c) => (c as { id?: number }).id === newId)
    }
    if (idx === -1 && oldTimestamp !== undefined) {
      idx = cmds.map((c) => c.timestamp).lastIndexOf(oldTimestamp)
    }
    if (idx === -1) {
      cmds.push(command)
    } else {
      cmds[idx] = command
    }
  }

  #mergeNetwork(incoming: NetworkRequestLike[]) {
    const byId = new Map<string, number>()
    this.#activeRun.networkRequests.forEach((r, i) => {
      if (r?.id) {
        byId.set(String(r.id), i)
      }
    })
    for (const req of incoming) {
      if (!req?.id) {
        this.#activeRun.networkRequests.push(req)
        continue
      }
      const idx = byId.get(String(req.id))
      if (idx === undefined) {
        byId.set(String(req.id), this.#activeRun.networkRequests.length)
        this.#activeRun.networkRequests.push(req)
      } else {
        this.#activeRun.networkRequests[idx] = req
      }
    }
  }

  #ingestSuites(payload: unknown) {
    const chunks = Array.isArray(payload) ? payload : [payload]
    for (const chunk of chunks) {
      if (!chunk || typeof chunk !== 'object') {
        continue
      }
      for (const suite of Object.values(chunk as Record<string, unknown>)) {
        this.#walkSuite(suite)
      }
    }
  }

  #walkSuite(node: unknown) {
    if (!node || typeof node !== 'object') {
      return
    }
    const n = node as Record<string, unknown>
    const uid = typeof n.uid === 'string' ? n.uid : undefined
    if (!uid) {
      return
    }
    const childUids: string[] = []
    const tests = Array.isArray(n.tests) ? (n.tests as unknown[]) : []
    for (const t of tests) {
      this.#walkTest(t, childUids)
    }
    const subSuites = Array.isArray(n.suites) ? (n.suites as unknown[]) : []
    for (const s of subSuites) {
      const subUid = (s as Record<string, unknown>)?.uid
      if (typeof subUid === 'string') {
        childUids.push(subUid)
      }
      this.#walkSuite(s)
    }
    this.#updateNode(uid, 'suite', n, childUids)
  }

  #walkTest(node: unknown, parentChildUids: string[]) {
    if (!node || typeof node !== 'object') {
      return
    }
    const n = node as Record<string, unknown>
    const uid = typeof n.uid === 'string' ? n.uid : undefined
    if (!uid) {
      return
    }
    parentChildUids.push(uid)
    this.#updateNode(uid, 'test', n, [])
  }

  #updateNode(
    uid: string,
    kind: 'suite' | 'test',
    n: Record<string, unknown>,
    childUids: string[]
  ) {
    const existing = this.#activeRun.nodes.get(uid)
    const incomingStart = toMs(n.start)
    const incomingEnd = toMs(n.end)

    // A new run is detected when the incoming start is strictly after the
    // previous run's end. Without this, repeated reruns balloon the window.
    const isNewRun =
      existing?.end !== undefined &&
      incomingStart !== undefined &&
      incomingStart > existing.end

    // A test re-executing (rerun, or a framework retry of a failed test) starts
    // a new attempt. Drop its previous attempt's commands so a preserve keeps
    // only the latest run — other tests' commands (accumulated across session
    // changes within one run) are left intact.
    if (isNewRun && kind === 'test') {
      this.#activeRun.commands = this.#activeRun.commands.filter(
        (c) => c.testUid !== uid
      )
    }

    const nextStart = isNewRun
      ? incomingStart
      : pickMin(existing?.start, incomingStart)
    const nextEnd = isNewRun ? incomingEnd : pickMax(existing?.end, incomingEnd)
    const nextState = isNewRun
      ? (n.state as NodeState | undefined)
      : ((n.state as NodeState | undefined) ?? existing?.state)
    const nextError = isNewRun
      ? (n.error as NodeError | undefined)
      : ((n.error as NodeError | undefined) ?? existing?.error)

    this.#activeRun.nodes.set(uid, {
      uid,
      kind,
      title: typeof n.title === 'string' ? n.title : existing?.title,
      fullTitle:
        typeof n.fullTitle === 'string' ? n.fullTitle : existing?.fullTitle,
      file: typeof n.file === 'string' ? n.file : existing?.file,
      callSource:
        typeof n.callSource === 'string' ? n.callSource : existing?.callSource,
      start: nextStart,
      end: nextEnd,
      state: nextState,
      error: nextError,
      childUids: childUids.length > 0 ? childUids : (existing?.childUids ?? [])
    })
  }

  #windowFor(uid: string): { start: number; end: number } | undefined {
    const node = this.#activeRun.nodes.get(uid)
    if (!node) {
      return undefined
    }
    let start = node.start ?? Number.POSITIVE_INFINITY
    let end = node.end ?? Date.now()
    const visit = (n: TimeWindowNode) => {
      if (n.start !== undefined && n.start < start) {
        start = n.start
      }
      const candidateEnd = n.end ?? Date.now()
      if (candidateEnd > end) {
        end = candidateEnd
      }
      for (const childUid of n.childUids) {
        const child = this.#activeRun.nodes.get(childUid)
        if (child) {
          visit(child)
        }
      }
    }
    visit(node)
    if (!Number.isFinite(start)) {
      return undefined
    }
    return { start, end }
  }

  /** Worst-case rollup so a suite snapshot doesn't show "unknown". */
  #deriveState(node: TimeWindowNode): NodeState | undefined {
    if (node.state) {
      return node.state
    }
    let hasFailed = false
    let hasRunning = false
    let hasPassed = false
    const visit = (n: TimeWindowNode) => {
      if (n.state === 'failed') {
        hasFailed = true
      } else if (n.state === 'running' || n.state === 'pending') {
        hasRunning = true
      } else if (n.state === 'passed') {
        hasPassed = true
      }
      for (const childUid of n.childUids) {
        const child = this.#activeRun.nodes.get(childUid)
        if (child) {
          visit(child)
        }
      }
    }
    visit(node)
    if (hasFailed) {
      return 'failed'
    }
    if (hasRunning) {
      return 'running'
    }
    if (hasPassed) {
      return 'passed'
    }
    return undefined
  }

  /** Falls back to the first failing descendant's error so suite snapshots
   *  carry the assertion text. */
  #deriveError(node: TimeWindowNode): NodeError | undefined {
    if (node.error?.message) {
      return node.error
    }
    for (const childUid of node.childUids) {
      const child = this.#activeRun.nodes.get(childUid)
      if (!child) {
        continue
      }
      const childError = this.#deriveError(child)
      if (childError?.message) {
        return childError
      }
    }
    return node.error
  }

  #collectStepsRecursive(node: TimeWindowNode, steps: PreservedStep[]): void {
    if (node.kind === 'test') {
      steps.push({
        uid: node.uid,
        title: node.title,
        fullTitle: node.fullTitle,
        start: node.start,
        end: node.end,
        state: node.state,
        error: node.error
      })
    }
    for (const childUid of node.childUids) {
      const child = this.#activeRun.nodes.get(childUid)
      if (child) {
        this.#collectStepsRecursive(child, steps)
      }
    }
  }

  #buildTestSnapshot(node: TimeWindowNode): PreservedAttempt['test'] {
    return {
      title: node.title,
      fullTitle: node.fullTitle,
      file: node.file,
      callSource: node.callSource,
      start: node.start,
      end: node.end,
      duration:
        node.start !== undefined && node.end !== undefined
          ? node.end - node.start
          : undefined,
      state: this.#deriveState(node),
      error: this.#deriveError(node)
    }
  }

  /** Tight [min,max] window from a command set's timestamps. */
  #spanOf(
    commands: CommandLogLike[]
  ): { start: number; end: number } | undefined {
    const ts = commands
      .map((c) => c.timestamp)
      .filter((t): t is number => t !== undefined)
    if (ts.length === 0) {
      return undefined
    }
    return { start: Math.min(...ts), end: Math.max(...ts) }
  }

  snapshot(uid: string, scope: 'test' | 'suite'): PreservedAttempt | undefined {
    const node = this.#activeRun.nodes.get(uid)
    if (!node) {
      return undefined
    }
    const nodeWindow = this.#windowFor(uid)
    const commands = commandsForNode(
      node,
      this.#activeRun.nodes,
      this.#activeRun.commands,
      nodeWindow
    )

    // Window for the non-uid streams: the matched commands' span, expanded by
    // the node window only when they overlap (a stale node window from a
    // previous run must not pull in unrelated events).
    const window = this.#resolveWindow(this.#spanOf(commands), nodeWindow)
    if (!window) {
      return undefined
    }
    const inWindow = (t: number | undefined) =>
      t !== undefined && t >= window.start && t <= window.end
    const inWindowSpan = (start?: number, end?: number) => {
      const s = start ?? end ?? 0
      const e = end ?? start ?? Date.now()
      return e >= window.start && s <= window.end
    }
    const steps: PreservedStep[] = []
    this.#collectStepsRecursive(node, steps)
    return {
      testUid: uid,
      scope,
      capturedAt: Date.now(),
      window,
      test: this.#buildTestSnapshot(node),
      steps: steps.length > 0 ? steps : undefined,
      commands,
      consoleLogs: this.#activeRun.consoleLogs.filter((c) =>
        inWindow(c.timestamp)
      ),
      networkRequests: this.#activeRun.networkRequests.filter((r) =>
        inWindowSpan(r.startTime ?? r.timestamp, r.endTime)
      ),
      mutations: this.#activeRun.mutations.filter((m) => inWindow(m.timestamp)),
      sources: { ...this.#activeRun.sources }
    }
  }

  /** Window for the non-uid event streams: the command span, expanded by the
   *  node window only when the two overlap (same run). A disjoint node window
   *  is stale — ignore it so the snapshot tracks the run the commands came from. */
  #resolveWindow(
    commandSpan: { start: number; end: number } | undefined,
    nodeWindow: { start: number; end: number } | undefined
  ): { start: number; end: number } | undefined {
    if (!commandSpan) {
      return nodeWindow
    }
    if (!nodeWindow) {
      return commandSpan
    }
    const overlap =
      nodeWindow.start <= commandSpan.end && nodeWindow.end >= commandSpan.start
    if (!overlap) {
      return commandSpan
    }
    return {
      start: Math.min(commandSpan.start, nodeWindow.start),
      end: Math.max(commandSpan.end, nodeWindow.end)
    }
  }

  preserve(uid: string, scope: 'test' | 'suite'): PreservedAttempt | undefined {
    const attempt = this.snapshot(uid, scope)
    if (!attempt) {
      log.warn(`preserve: no data captured for uid=${uid}`)
      return undefined
    }
    if (attempt.commands.length === 0) {
      log.warn(`preserve: empty command window for uid=${uid}`)
      return undefined
    }
    this.#baselines.set(uid, attempt)
    log.info(
      `preserve: stored baseline for uid=${uid} (${attempt.commands.length} commands)`
    )
    return attempt
  }

  clear(uid: string): boolean {
    return this.#baselines.delete(uid)
  }

  clearAll(): string[] {
    const uids = Array.from(this.#baselines.keys())
    this.#baselines.clear()
    return uids
  }

  get(uid: string): PreservedAttempt | undefined {
    return this.#baselines.get(uid)
  }

  getPair(uid: string, scope: 'test' | 'suite' = 'test') {
    const baseline = this.#baselines.get(uid)
    const latest = baseline
      ? this.snapshot(uid, baseline.scope)
      : this.snapshot(uid, scope)
    return { baseline, latest }
  }
}

export const baselineStore = new BaselineStore()
