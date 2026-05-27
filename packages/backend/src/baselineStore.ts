/**
 * In-memory baseline store for the "Preserve & Rerun" feature.
 *
 * The backend already forwards worker socket frames to all dashboard clients.
 * We tee a copy of each event into an accumulator (`activeRun`) so a snapshot
 * can be taken at any point and pinned as a baseline for a specific test/suite.
 *
 * Per-test scoping is achieved by tracking each test/suite's time window from
 * the `suites` payloads (each TestStats/SuiteStats carries `start`/`end` dates),
 * then filtering the flat command/log streams by timestamp at snapshot time.
 * No reporter changes required.
 */
import logger from '@wdio/logger'

const log = logger('@wdio/devtools-baseline')

interface CommandLogLike {
  timestamp: number
  [key: string]: unknown
}
interface ConsoleLogLike {
  timestamp: number
  [key: string]: unknown
}
interface NetworkRequestLike {
  id?: string
  timestamp: number
  startTime?: number
  endTime?: number
  [key: string]: unknown
}
interface MutationLike {
  timestamp: number
  [key: string]: unknown
}

interface TimeWindowNode {
  uid: string
  kind: 'suite' | 'test'
  title?: string
  fullTitle?: string
  file?: string
  callSource?: string
  start?: number
  end?: number
  state?: 'passed' | 'failed' | 'skipped' | 'pending' | 'running'
  error?: { message: string; name?: string; stack?: string }
  childUids: string[]
}

export interface PreservedStep {
  uid: string
  title?: string
  fullTitle?: string
  start?: number
  end?: number
  state?: TimeWindowNode['state']
  error?: TimeWindowNode['error']
}

export interface PreservedAttempt {
  testUid: string
  scope: 'test' | 'suite'
  capturedAt: number
  window: { start: number; end: number }
  test: {
    title?: string
    fullTitle?: string
    file?: string
    callSource?: string
    start?: number
    end?: number
    duration?: number
    state?: TimeWindowNode['state']
    error?: TimeWindowNode['error']
  }
  steps?: PreservedStep[]
  commands: CommandLogLike[]
  consoleLogs: ConsoleLogLike[]
  networkRequests: NetworkRequestLike[]
  mutations: MutationLike[]
  sources: Record<string, string>
}

interface ActiveRun {
  commands: CommandLogLike[]
  consoleLogs: ConsoleLogLike[]
  networkRequests: NetworkRequestLike[]
  mutations: MutationLike[]
  sources: Record<string, string>
  nodes: Map<string, TimeWindowNode>
  startedAt: number
}

function freshRun(): ActiveRun {
  return {
    commands: [],
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    sources: {},
    nodes: new Map(),
    startedAt: Date.now()
  }
}

function toMs(value: unknown): number | undefined {
  if (value == null) {
    return undefined
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return Number.isFinite(t) ? t : undefined
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return undefined
}

class BaselineStore {
  #activeRun: ActiveRun = freshRun()
  #baselines = new Map<string, PreservedAttempt>()

  resetActiveRun() {
    log.debug('resetting activeRun')
    this.#activeRun = freshRun()
  }

  /**
   * Tee an incoming worker WS frame into the active-run accumulator.
   * Mirrors the same payload shapes the dashboard already consumes.
   */
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
        Object.assign(
          this.#activeRun.sources,
          data as Record<string, string>
        )
        return
      case 'suites':
        this.#ingestSuites(data)
        return
      default:
        return
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
    const merged: TimeWindowNode = {
      uid,
      kind,
      title: typeof n.title === 'string' ? n.title : existing?.title,
      fullTitle:
        typeof n.fullTitle === 'string' ? n.fullTitle : existing?.fullTitle,
      file: typeof n.file === 'string' ? n.file : existing?.file,
      callSource:
        typeof n.callSource === 'string'
          ? n.callSource
          : existing?.callSource,
      start:
        incomingStart != null && (existing?.start == null || incomingStart < existing.start)
          ? incomingStart
          : existing?.start ?? incomingStart,
      end:
        incomingEnd != null && (existing?.end == null || incomingEnd > existing.end)
          ? incomingEnd
          : existing?.end ?? incomingEnd,
      state: (n.state as TimeWindowNode['state']) ?? existing?.state,
      error: (n.error as TimeWindowNode['error']) ?? existing?.error,
      childUids:
        childUids.length > 0 ? childUids : existing?.childUids ?? []
    }
    this.#activeRun.nodes.set(uid, merged)
  }

  /**
   * Compute the [start, end] time window for a uid by unioning the windows
   * of all descendant tests (or the test's own window).
   */
  #windowFor(uid: string): { start: number; end: number } | undefined {
    const node = this.#activeRun.nodes.get(uid)
    if (!node) {
      return undefined
    }
    let start = node.start ?? Number.POSITIVE_INFINITY
    let end = node.end ?? Date.now()
    const visit = (n: TimeWindowNode) => {
      if (n.start != null && n.start < start) {
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

  /**
   * Derive a state for a node when its own state is undefined. WDIO doesn't
   * set explicit state on SuiteStats — so a passed/failed suite snapshot
   * would otherwise show "unknown" in the UI. Walk descendants and use the
   * worst-case outcome (failed > running > passed).
   */
  #deriveState(node: TimeWindowNode): TimeWindowNode['state'] {
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

  /**
   * Build a PreservedAttempt for the given uid by filtering activeRun
   * streams to the time window of that test/suite.
   */
  snapshot(uid: string, scope: 'test' | 'suite'): PreservedAttempt | undefined {
    const node = this.#activeRun.nodes.get(uid)
    if (!node) {
      return undefined
    }
    const window = this.#windowFor(uid)
    if (!window) {
      return undefined
    }
    const inWindow = (t: number | undefined) =>
      t != null && t >= window.start && t <= window.end
    const inWindowSpan = (start?: number, end?: number) => {
      const s = start ?? end ?? 0
      const e = end ?? start ?? Date.now()
      return e >= window.start && s <= window.end
    }

    const commands = this.#activeRun.commands.filter((c) =>
      inWindow(c.timestamp)
    )
    const consoleLogs = this.#activeRun.consoleLogs.filter((c) =>
      inWindow(c.timestamp)
    )
    const networkRequests = this.#activeRun.networkRequests.filter((r) =>
      inWindowSpan(r.startTime ?? r.timestamp, r.endTime)
    )
    const mutations = this.#activeRun.mutations.filter((m) =>
      inWindow(m.timestamp)
    )

    // Collect descendant test (step) nodes for step-level attribution in the
    // Compare tab. A failed step's commands can then be marked even when the
    // commands themselves succeeded (typical for an assertion failure).
    const steps: PreservedStep[] = []
    const collectSteps = (n: TimeWindowNode) => {
      if (n.kind === 'test') {
        steps.push({
          uid: n.uid,
          title: n.title,
          fullTitle: n.fullTitle,
          start: n.start,
          end: n.end,
          state: n.state,
          error: n.error
        })
      }
      for (const childUid of n.childUids) {
        const child = this.#activeRun.nodes.get(childUid)
        if (child) {
          collectSteps(child)
        }
      }
    }
    collectSteps(node)

    return {
      testUid: uid,
      scope,
      capturedAt: Date.now(),
      window,
      test: {
        title: node.title,
        fullTitle: node.fullTitle,
        file: node.file,
        callSource: node.callSource,
        start: node.start,
        end: node.end,
        duration:
          node.start != null && node.end != null
            ? node.end - node.start
            : undefined,
        state: this.#deriveState(node),
        error: node.error
      },
      steps: steps.length > 0 ? steps : undefined,
      commands,
      consoleLogs,
      networkRequests,
      mutations,
      sources: { ...this.#activeRun.sources }
    }
  }

  preserve(
    uid: string,
    scope: 'test' | 'suite'
  ): PreservedAttempt | undefined {
    const attempt = this.snapshot(uid, scope)
    if (!attempt) {
      log.warn(
        `preserve: no data captured for uid=${uid}; refusing empty snapshot`
      )
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

  get(uid: string): PreservedAttempt | undefined {
    return this.#baselines.get(uid)
  }

  /**
   * For dashboard rehydration: baseline + a fresh snapshot of the current
   * activeRun for the same uid (the "latest" side of the compare view).
   */
  getPair(uid: string, scope: 'test' | 'suite' = 'test') {
    const baseline = this.#baselines.get(uid)
    const latest = baseline
      ? this.snapshot(uid, baseline.scope)
      : this.snapshot(uid, scope)
    return { baseline, latest }
  }
}

export const baselineStore = new BaselineStore()
