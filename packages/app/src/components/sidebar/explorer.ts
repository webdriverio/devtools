import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { TestStats, SuiteStats } from '@wdio/reporter'
import type { Metadata } from '@wdio/devtools-service/types'
import { repeat } from 'lit/directives/repeat.js'
import { suiteContext, metadataContext } from '../../controller/context.js'
import type {
  TestEntry,
  RunCapabilities,
  RunnerOptions,
  TestRunDetail
} from './types.js'
import { TestState } from './types.js'
import {
  DEFAULT_CAPABILITIES,
  FRAMEWORK_CAPABILITIES,
  STATE_MAP
} from './constants.js'

import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/eye.js'
import '~icons/mdi/collapse-all.js'
import '~icons/mdi/expand-all.js'

import './test-suite.js'
import { CollapseableEntry } from './collapseableEntry.js'
import type { DevtoolsSidebarFilter } from './filter.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'

@customElement(EXPLORER)
export class DevtoolsSidebarExplorer extends CollapseableEntry {
  #testFilter: DevtoolsSidebarFilter | undefined
  #filterListener = this.#filterTests.bind(this)
  #runListener = this.#handleTestRun.bind(this)
  #stopListener = this.#handleTestStop.bind(this)

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      header {
        flex: 0 0 auto;
      }

      wdio-test-suite {
        flex: 1 1 auto;
        overflow-y: auto;
        overflow-x: hidden;
        min-height: 0;
        scrollbar-width: none;
      }
    `
  ]

  @consume({ context: suiteContext, subscribe: true })
  @property({ type: Array })
  suites: Record<string, SuiteStats>[] | undefined = undefined

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-test-filter', this.#filterListener)
    this.addEventListener('app-test-run', this.#runListener as EventListener)
    this.addEventListener('app-test-stop', this.#stopListener as EventListener)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('app-test-filter', this.#filterListener)
    this.removeEventListener('app-test-run', this.#runListener as EventListener)
    this.removeEventListener(
      'app-test-stop',
      this.#stopListener as EventListener
    )
  }

  #filterTests({ detail }: { detail: DevtoolsSidebarFilter }) {
    this.#testFilter = detail
    this.requestUpdate()
  }

  async #handleTestRun(event: Event) {
    event.stopPropagation()
    const detail = (event as CustomEvent<TestRunDetail>).detail
    if (this.#isRunDisabledDetail(detail)) {
      this.#surfaceCapabilityWarning(detail)
      return
    }

    // Clear execution data before triggering rerun
    this.dispatchEvent(
      new CustomEvent('clear-execution-data', {
        detail: { uid: detail.uid, entryType: detail.entryType },
        bubbles: true,
        composed: true
      })
    )

    const payload = {
      ...detail,
      runAll: detail.uid === '*',
      framework: this.#getFramework(),
      specFile: detail.specFile || this.#deriveSpecFile(detail),
      configFile: this.#getConfigPath()
    }
    await this.#postToBackend('/api/tests/run', payload)
  }

  async #handleTestStop(event: Event) {
    event.stopPropagation()
    await this.#postToBackend('/api/tests/stop', {})
  }

  async #postToBackend(path: string, body: Record<string, unknown>) {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'Unknown error')
      }
    } catch (error) {
      console.error('Failed to communicate with backend', error)
      window.dispatchEvent(
        new CustomEvent('app-logs', {
          detail: `Test runner error: ${(error as Error).message}`
        })
      )
    }
  }

  #deriveSpecFile(detail: TestRunDetail) {
    if (detail.specFile) {
      return detail.specFile
    }
    const source = detail.callSource
    if (source?.startsWith('file://')) {
      try {
        return new URL(source).pathname
      } catch {
        return source
      }
    }
    if (source) {
      const match = source.match(/^(.*?):\d+:\d+$/)
      if (match?.[1]) {
        return match[1]
      }
      return source
    }

    return undefined
  }

  #runAllSuites() {
    if (!this.#getRunCapabilities().canRunSuites) {
      this.#surfaceCapabilityWarning({
        entryType: 'suite',
        uid: '*'
      } as TestRunDetail)
      return
    }

    // Clear execution data and mark all tests as running
    this.dispatchEvent(
      new CustomEvent('clear-execution-data', {
        detail: { uid: '*', entryType: 'suite' },
        bubbles: true,
        composed: true
      })
    )

    void this.#postToBackend('/api/tests/run', {
      uid: '*',
      entryType: 'suite',
      runAll: true,
      framework: this.#getFramework(),
      configFile: this.#getConfigPath()
    })
  }

  #stopActiveRun() {
    void this.#postToBackend('/api/tests/stop', {
      uid: '*'
    })
  }

  #getFramework(): string | undefined {
    return this.#getRunnerOptions()?.framework
  }

  #getRunnerOptions(): RunnerOptions | undefined {
    return this.metadata?.options as RunnerOptions | undefined
  }

  #getRunCapabilities(): RunCapabilities {
    const options = this.#getRunnerOptions()
    if (options?.runCapabilities) {
      return {
        ...DEFAULT_CAPABILITIES,
        ...options.runCapabilities
      }
    }
    const framework = options?.framework?.toLowerCase() ?? ''
    return FRAMEWORK_CAPABILITIES[framework] || DEFAULT_CAPABILITIES
  }

  #isRunDisabled(entry: TestEntry) {
    const caps = this.#getRunCapabilities()
    if (entry.type === 'test' && !caps.canRunTests) {
      return true
    }
    if (entry.type === 'suite' && !caps.canRunSuites) {
      return true
    }
    return false
  }

  #isRunDisabledDetail(detail: TestRunDetail) {
    const caps = this.#getRunCapabilities()
    if (detail.entryType === 'test' && !caps.canRunTests) {
      return true
    }
    if (detail.entryType === 'suite' && !caps.canRunSuites) {
      return true
    }
    return false
  }

  #surfaceCapabilityWarning(detail: TestRunDetail) {
    const message =
      detail.entryType === 'test'
        ? 'Single-test execution is not supported by this framework.'
        : 'Suite execution is disabled by this framework.'
    window.dispatchEvent(
      new CustomEvent('app-logs', {
        detail: message
      })
    )
  }

  #getRunDisabledReason(entry: TestEntry) {
    if (!this.#isRunDisabled(entry)) {
      return undefined
    }
    return entry.type === 'test'
      ? 'Single-test execution is not supported by this framework.'
      : 'Suite execution is not supported by this framework.'
  }

  #getConfigPath(): string | undefined {
    const options = this.#getRunnerOptions()
    return options?.configFilePath || options?.configFile
  }

  #renderEntry(entry: TestEntry): TemplateResult {
    return html`
      <wdio-test-entry
        uid="${entry.uid}"
        state="${entry.state as any}"
        call-source="${entry.callSource || ''}"
        entry-type="${entry.type}"
        spec-file="${entry.specFile || ''}"
        full-title="${entry.fullTitle || ''}"
        label-text="${entry.label}"
        feature-file="${entry.featureFile || ''}"
        feature-line="${entry.featureLine ?? ''}"
        suite-type="${entry.suiteType || ''}"
        ?has-children="${entry.children && entry.children.length > 0}"
        .runDisabled=${this.#isRunDisabled(entry)}
        .runDisabledReason=${this.#getRunDisabledReason(entry)}
      >
        <label slot="label">${entry.label}</label>
        ${entry.children && entry.children.length
          ? html`
              <wdio-test-suite slot="children">
                ${repeat(
                  entry.children,
                  (child) => child.uid,
                  (child) => this.#renderEntry(child)
                )}
              </wdio-test-suite>
            `
          : nothing}
      </wdio-test-entry>
    `
  }

  #filterEntry(entry: TestEntry): boolean {
    if (!this.#testFilter) {
      return true
    }

    const entryLabelIncludingChildren = getSearchableLabel(entry)
      .flat(Infinity)
      .join(' ')
    return (
      Boolean(
        ['all', 'none'].includes(this.#testFilter.filterStatus) ||
        (entry.state === TestState.PASSED && this.#testFilter.filtersPassed) ||
        (entry.state === TestState.FAILED && this.#testFilter.filtersFailed) ||
        (entry.state === TestState.SKIPPED && this.#testFilter.filtersSkipped)
      ) &&
      (!this.#testFilter.filterQuery ||
        entryLabelIncludingChildren
          .toLowerCase()
          .includes(this.#testFilter.filterQuery.toLowerCase()))
    )
  }

  #isRunning(entry: TestStats | SuiteStats): boolean {
    if ('tests' in entry) {
      // Fastest path: any explicitly running descendant
      if (
        entry.tests.some((t) => (t as any).state === 'running') ||
        entry.suites.some((s) => this.#isRunning(s))
      ) {
        return true
      }

      const hasPendingTests = entry.tests.some(
        (t) => (t as any).state === 'pending'
      )
      const hasPendingSuites = entry.suites.some((s) => this.#hasPending(s))
      const suiteState = (entry as any).state

      // If the suite was explicitly marked 'running' (e.g. by markTestAsRunning)
      // and still has pending children, it's actively executing.
      if (suiteState === 'running' && (hasPendingTests || hasPendingSuites)) {
        return true
      }

      // Mixed terminal + pending children = run is in progress regardless of
      // explicit suite state (handles Nightwatch Cucumber where the feature
      // suite state may be undefined in the JSON payload).
      const allDescendants = [...entry.tests, ...entry.suites]
      const hasSomeTerminal = allDescendants.some(
        (t) =>
          (t as any).state === 'passed' ||
          (t as any).state === 'failed' ||
          (t as any).state === 'skipped'
      )
      if ((hasPendingTests || hasPendingSuites) && hasSomeTerminal) {
        return true
      }

      return false
    }
    // For individual tests rely on explicit state only.
    return (entry as any).state === 'running'
  }

  #hasPending(entry: TestStats | SuiteStats): boolean {
    if ('tests' in entry) {
      if ((entry as any).state === 'pending') {
        return true
      }
      if (entry.tests.some((t) => (t as any).state === 'pending')) {
        return true
      }
      if (entry.suites.some((s) => this.#hasPending(s))) {
        return true
      }
      return false
    }
    return (entry as any).state === 'pending'
  }

  #hasFailed(entry: TestStats | SuiteStats): boolean {
    if ('tests' in entry) {
      // Check if any immediate test failed
      if (entry.tests.find((t) => t.state === 'failed')) {
        return true
      }
      // Check if any nested suite has failures
      if (entry.suites.some((s) => this.#hasFailed(s))) {
        return true
      }
      return false
    }
    // For individual tests
    return entry.state === 'failed'
  }

  #computeEntryState(entry: TestStats | SuiteStats): TestState | 'pending' {
    // For suites, check running state from children FIRST — this ensures that
    // a rerun (which clears end times) shows the spinner immediately, even if
    // the suite still has a cached 'passed'/'failed' state from the previous run.
    if ('tests' in entry && this.#isRunning(entry)) {
      return TestState.RUNNING
    }

    const state = (entry as any).state

    // For suites with no explicit terminal state, derive from children.
    // A suite with state=undefined or state=pending that has no terminal
    // children yet is still in-progress — don't show PASSED prematurely.
    if (
      'tests' in entry &&
      (state === null || state === 'pending' || state === 'running')
    ) {
      const allDescendants = [...entry.tests, ...entry.suites]
      if (allDescendants.length > 0) {
        const allTerminal = allDescendants.every(
          (t) =>
            (t as any).state === 'passed' ||
            (t as any).state === 'failed' ||
            (t as any).state === 'skipped'
        )
        if (!allTerminal) {
          // Still has non-terminal children — treat as running/loading
          return TestState.RUNNING
        }
      }
    }

    // Check explicit terminal state
    const mappedState = STATE_MAP[state]
    if (mappedState) {
      return mappedState
    }

    // For suites, compute state from children
    if ('tests' in entry) {
      if (this.#hasFailed(entry)) {
        return TestState.FAILED
      }
      return TestState.PASSED
    }

    // For individual leaf tests: pending = spinner (run is in progress),
    // not circle (which implies "never run").
    if (state === 'pending') {
      return TestState.RUNNING
    }

    return entry.end ? TestState.PASSED : 'pending'
  }

  #getTestEntry(entry: TestStats | SuiteStats): TestEntry {
    if ('tests' in entry) {
      const entries = [...entry.tests, ...entry.suites]
      // A suite whose children are themselves suites is a feature/file-level
      // container (Cucumber feature or test file). Tag it as 'feature' so the
      // backend runner can distinguish it from a scenario/spec-level suite and
      // avoid applying a --name filter that would match no scenarios.
      const hasChildSuites = entry.suites && entry.suites.length > 0
      const derivedType = hasChildSuites
        ? 'feature'
        : (entry as any).type || 'suite'
      return {
        uid: entry.uid,
        label: entry.title,
        type: 'suite',
        state: this.#computeEntryState(entry),
        callSource: (entry as any).callSource,
        specFile: (entry as any).file,
        fullTitle: entry.title,
        featureFile: (entry as any).featureFile,
        featureLine: (entry as any).featureLine,
        suiteType: derivedType,
        children: Object.values(entries)
          .map(this.#getTestEntry.bind(this))
          .filter(this.#filterEntry.bind(this))
      }
    }
    return {
      uid: entry.uid,
      label: entry.title,
      type: 'test',
      state: this.#computeEntryState(entry),
      callSource: (entry as any).callSource,
      specFile: (entry as any).file,
      fullTitle: (entry as any).fullTitle || entry.title,
      featureFile: (entry as any).featureFile,
      featureLine: (entry as any).featureLine,
      children: []
    }
  }

  render() {
    if (!this.suites) {
      return
    }

    const rootSuites = this.suites
      .flatMap((s) => Object.values(s))
      .filter((suite) => !suite.parent)

    const uniqueSuites = Array.from(
      new Map(rootSuites.map((suite) => [suite.uid, suite])).values()
    )

    const suites = uniqueSuites
      .map(this.#getTestEntry.bind(this))
      .filter(this.#filterEntry.bind(this))

    return html`
      <header class="pl-4 py-2 flex shadow-md pr-2">
        <h3 class="flex content-center flex-wrap uppercase font-bold text-sm">
          Tests
        </h3>
        <nav class="flex ml-auto">
          <button
            class="p-1 rounded text-sm group ${this.#getRunCapabilities()
              .canRunAll
              ? 'hover:bg-toolbarHoverBackground'
              : 'opacity-30 cursor-not-allowed'}"
            ?disabled=${!this.#getRunCapabilities().canRunAll}
            @click="${() => this.#runAllSuites()}"
          >
            <icon-mdi-play
              class="${this.#getRunCapabilities().canRunAll
                ? 'group-hover:text-chartsGreen'
                : ''}"
            ></icon-mdi-play>
          </button>
          <button
            class="p-1 rounded text-sm group ${this.#getRunCapabilities()
              .canRunAll
              ? 'hover:bg-toolbarHoverBackground'
              : 'opacity-30 cursor-not-allowed'}"
            ?disabled=${!this.#getRunCapabilities().canRunAll}
            @click="${() => this.#stopActiveRun()}"
          >
            <icon-mdi-stop
              class="${this.#getRunCapabilities().canRunAll
                ? 'group-hover:text-chartsRed'
                : ''}"
            ></icon-mdi-stop>
          </button>
          <button
            class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"
          >
            <icon-mdi-eye class="group-hover:text-chartsYellow"></icon-mdi-eye>
          </button>
          <button
            class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"
          >
            ${this.renderCollapseOrExpandIcon('group-hover:text-chartsBlue')}
          </button>
        </nav>
      </header>
      <wdio-test-suite>
        ${suites.length
          ? repeat(
              suites,
              (suite) => suite.uid,
              (suite) => this.#renderEntry(suite)
            )
          : html`<div class="text-sm px-4 py-2">
              <p class="text-disabledForeground">No tests to display</p>
            </div>`}
      </wdio-test-suite>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [EXPLORER]: DevtoolsSidebarExplorer
  }
}

function getSearchableLabel(entry: TestEntry): string[] {
  if (entry.children.length === 0) {
    return [entry.label]
  }
  return entry.children.map(getSearchableLabel) as any as string[]
}
