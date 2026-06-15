import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { Metadata } from '@wdio/devtools-shared'
import { repeat } from 'lit/directives/repeat.js'
import { suiteContext, metadataContext } from '../../controller/context.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../controller/types.js'
import type { TestEntry, TestRunDetail, StatusFilterDetail } from './types.js'
import type { TestStatus } from '@wdio/devtools-shared'
import { getTestEntry } from './test-entry-state.js'
import { entryPassesFilter } from './tree-filter.js'
import {
  getCapabilityWarning,
  getConfigPath,
  getFramework,
  getLaunchCommand,
  getRerunCommand,
  getRunCapabilities,
  getRunDisabledReason,
  isRunDisabled,
  isRunDisabledDetail
} from './runnerCapabilities.js'
import {
  BASELINE_API,
  TESTS_API,
  type BaselinePreserveRequest,
  type RunnerRequestBody
} from '@wdio/devtools-shared'

import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/collapse-all.js'
import '~icons/mdi/expand-all.js'

import './test-suite.js'
import { CollapseableEntry } from './collapseableEntry.js'
import type { DevtoolsSidebarFilter } from './filter.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'

@customElement(EXPLORER)
export class DevtoolsSidebarExplorer extends CollapseableEntry {
  #query = ''
  #statusFilter: TestStatus | null = null
  #selectedUid?: string
  #autoSelectedUid?: string
  #filterListener = this.#filterTests.bind(this)
  #statusFilterListener = this.#applyStatusFilter.bind(this)
  #selectListener = this.#handleSelect.bind(this)
  #runListener = this.#handleTestRun.bind(this)
  #stopListener = this.#handleTestStop.bind(this)
  #preserveRerunListener = this.#handlePreserveAndRerun.bind(this)

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
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
  suites: Record<string, SuiteStatsFragment>[] | undefined = undefined

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties)
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-test-filter', this.#filterListener)
    window.addEventListener('app-status-filter', this.#statusFilterListener)
    this.addEventListener(
      'app-test-select',
      this.#selectListener as EventListener
    )
    this.addEventListener('app-test-run', this.#runListener as EventListener)
    this.addEventListener('app-test-stop', this.#stopListener as EventListener)
    this.addEventListener(
      'app-test-preserve-rerun',
      this.#preserveRerunListener as EventListener
    )
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener('app-test-filter', this.#filterListener)
    window.removeEventListener('app-status-filter', this.#statusFilterListener)
    this.removeEventListener(
      'app-test-select',
      this.#selectListener as EventListener
    )
    this.removeEventListener('app-test-run', this.#runListener as EventListener)
    this.removeEventListener(
      'app-test-stop',
      this.#stopListener as EventListener
    )
    this.removeEventListener(
      'app-test-preserve-rerun',
      this.#preserveRerunListener as EventListener
    )
  }

  #filterTests({ detail }: { detail: DevtoolsSidebarFilter }) {
    this.#query = detail.filterQuery
    this.requestUpdate()
  }

  #applyStatusFilter({ detail }: { detail: StatusFilterDetail }) {
    this.#statusFilter = detail.status
    this.requestUpdate()
  }

  #handleSelect(event: CustomEvent<string>) {
    this.#selectedUid = event.detail
    this.requestUpdate()
  }

  // Deepest running entry (a running step/test), so the highlight tracks the
  // most specific in-progress row rather than its parent suite.
  #findRunningUid(entries: TestEntry[]): string | undefined {
    for (const entry of entries) {
      const child =
        entry.children && entry.children.length
          ? this.#findRunningUid(entry.children)
          : undefined
      if (child) {
        return child
      }
      if (entry.state === 'running') {
        return entry.uid
      }
    }
    return undefined
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

    // Forward preserveBaseline so the backend knows whether to drop baselines.
    const payload: RunnerRequestBody = {
      ...detail,
      runAll: detail.uid === '*',
      framework: this.#getFramework(),
      specFile: detail.specFile || this.#deriveSpecFile(detail),
      configFile: this.#getConfigPath(),
      rerunCommand: this.#getRerunCommand(),
      launchCommand: this.#getLaunchCommand(),
      preserveBaseline: detail.preserveBaseline === true
    }
    await this.#postToBackend(TESTS_API.run, payload)
  }

  async #handleTestStop(event: Event) {
    event.stopPropagation()
    await this.#postToBackend(TESTS_API.stop, {})
  }

  async #handlePreserveAndRerun(event: Event) {
    event.stopPropagation()
    const detail = (event as CustomEvent<TestRunDetail>).detail
    if (this.#isRunDisabledDetail(detail)) {
      this.#surfaceCapabilityWarning(detail)
      return
    }

    // Snapshot the current run BEFORE the rerun clears live data.
    try {
      const body: BaselinePreserveRequest = {
        testUid: detail.uid,
        scope: detail.entryType
      }
      const response = await fetch(BASELINE_API.preserve, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const errorText = await response.text()
        window.dispatchEvent(
          new CustomEvent('app-logs', {
            detail: `Failed to preserve baseline: ${errorText}`
          })
        )
        return // skip rerun if preserve failed — no comparison value
      }
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('app-logs', {
          detail: `Preserve error: ${(error as Error).message}`
        })
      )
      return
    }

    // Flag the rerun so #handleTestRun doesn't wipe the baseline we just saved.
    this.dispatchEvent(
      new CustomEvent<TestRunDetail>('app-test-run', {
        detail: { ...detail, preserveBaseline: true },
        bubbles: true,
        composed: true
      })
    )
  }

  async #postToBackend(
    path: typeof TESTS_API.run | typeof TESTS_API.stop,
    body: RunnerRequestBody | Record<string, never>
  ) {
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

    const payload: RunnerRequestBody = {
      uid: '*',
      entryType: 'suite',
      runAll: true,
      framework: this.#getFramework(),
      configFile: this.#getConfigPath(),
      rerunCommand: this.#getRerunCommand(),
      launchCommand: this.#getLaunchCommand()
    }
    void this.#postToBackend(TESTS_API.run, payload)
  }

  #stopActiveRun() {
    // Backend ignores the body for /api/tests/stop — sending {} keeps the
    // typed helper happy without changing behavior.
    void this.#postToBackend(TESTS_API.stop, {})
  }

  #getFramework() {
    return getFramework(this.metadata)
  }
  #getRunCapabilities() {
    return getRunCapabilities(this.metadata)
  }
  #isRunDisabled(entry: TestEntry) {
    return isRunDisabled(this.metadata, entry)
  }
  #isRunDisabledDetail(detail: TestRunDetail) {
    return isRunDisabledDetail(this.metadata, detail)
  }
  #surfaceCapabilityWarning(detail: TestRunDetail) {
    window.dispatchEvent(
      new CustomEvent('app-logs', { detail: getCapabilityWarning(detail) })
    )
  }
  #getRunDisabledReason(entry: TestEntry) {
    return getRunDisabledReason(this.metadata, entry)
  }
  #getConfigPath() {
    return getConfigPath(this.metadata)
  }
  #getRerunCommand() {
    return getRerunCommand(this.metadata)
  }
  #getLaunchCommand() {
    return getLaunchCommand(this.metadata)
  }

  #renderEntry(entry: TestEntry, isRoot = false): TemplateResult {
    return html`
      <wdio-test-entry
        uid="${entry.uid}"
        state="${entry.state ?? ''}"
        call-source="${entry.callSource || ''}"
        entry-type="${entry.type}"
        spec-file="${entry.specFile || ''}"
        full-title="${entry.fullTitle || ''}"
        label-text="${entry.label}"
        feature-file="${entry.featureFile || ''}"
        feature-line="${entry.featureLine ?? ''}"
        suite-type="${entry.suiteType || ''}"
        ?has-children="${entry.children && entry.children.length > 0}"
        ?selected="${entry.uid ===
        (this.#selectedUid ?? this.#autoSelectedUid)}"
        ?root="${isRoot}"
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
    return entryPassesFilter(entry, this.#query, this.#statusFilter)
  }

  #getTestEntry(entry: TestStatsFragment | SuiteStatsFragment): TestEntry {
    return getTestEntry(entry, this.#filterEntry.bind(this))
  }

  #renderHeaderToolbar() {
    const canRunAll = this.#getRunCapabilities().canRunAll
    const runBtnCls = canRunAll
      ? 'hover:bg-toolbarHoverBackground'
      : 'opacity-30 cursor-not-allowed'
    const iconCls = (color: string) => (canRunAll ? `group-hover:${color}` : '')
    return html`
      <nav class="flex ml-auto gap-0.5 text-[16px] text-descriptionForeground">
        <button
          class="p-1 rounded group ${runBtnCls}"
          ?disabled=${!canRunAll}
          title="Run all"
          @click="${() => this.#runAllSuites()}"
        >
          <icon-mdi-play class="${iconCls('text-chartsGreen')}"></icon-mdi-play>
        </button>
        <button
          class="p-1 rounded group ${runBtnCls}"
          ?disabled=${!canRunAll}
          title="Stop"
          @click="${() => this.#stopActiveRun()}"
        >
          <icon-mdi-stop class="${iconCls('text-chartsRed')}"></icon-mdi-stop>
        </button>
        <button
          class="p-1 rounded hover:bg-toolbarHoverBackground group"
          title="Collapse / expand all"
        >
          ${this.renderCollapseOrExpandIcon('group-hover:text-chartsBlue')}
        </button>
      </nav>
    `
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
    this.#autoSelectedUid = this.#findRunningUid(suites)
    return html`
      <header class="px-3 py-2 flex shadow-md">
        <h3
          class="flex content-center flex-wrap uppercase font-bold text-[11px] tracking-[0.8px] text-disabledForeground"
        >
          Tests
        </h3>
        ${this.#renderHeaderToolbar()}
      </header>
      <wdio-test-suite>
        ${suites.length
          ? repeat(
              suites,
              (suite) => suite.uid,
              (suite) => this.#renderEntry(suite, true)
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
