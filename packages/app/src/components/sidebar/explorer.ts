import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { TestStats, SuiteStats } from '@wdio/reporter'
import type { Metadata } from '@wdio/devtools-service/types'
import { repeat } from 'lit/directives/repeat.js'
import {
  suiteContext,
  metadataContext,
  isTestRunningContext
} from '../../controller/DataManager.js'
import type {
  TestEntry,
  RunCapabilities,
  RunnerOptions,
  TestRunDetail
} from './types.js'
import { TestState } from './types.js'
import { DEFAULT_CAPABILITIES, FRAMEWORK_CAPABILITIES } from './constants.js'

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
  suites: Record<string, SuiteStats>[] | undefined = undefined

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  @consume({ context: isTestRunningContext, subscribe: true })
  isTestRunning = false

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
        detail: { uid: detail.uid },
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
        detail: { uid: '*' },
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

  #getTestEntry(entry: TestStats | SuiteStats): TestEntry {
    if ('tests' in entry) {
      const entries = [...entry.tests, ...entry.suites]
      return {
        uid: entry.uid,
        label: entry.title,
        type: 'suite',
        state: entry.tests.some((t) => !t.end)
          ? TestState.RUNNING
          : entry.tests.find((t) => t.state === 'failed')
            ? TestState.FAILED
            : TestState.PASSED,
        callSource: (entry as any).callSource,
        specFile: (entry as any).file,
        fullTitle: entry.title,
        featureFile: (entry as any).featureFile,
        featureLine: (entry as any).featureLine,
        suiteType: (entry as any).type,
        children: Object.values(entries)
          .map(this.#getTestEntry.bind(this))
          .filter(this.#filterEntry.bind(this))
      }
    }
    return {
      uid: entry.uid,
      label: entry.title,
      type: 'test',
      state: !entry.end
        ? TestState.RUNNING
        : entry.state === 'failed'
          ? TestState.FAILED
          : TestState.PASSED,
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
            class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"
            @click="${() => this.#runAllSuites()}"
          >
            <icon-mdi-play class="group-hover:text-chartsGreen"></icon-mdi-play>
          </button>
          <button
            class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"
            @click="${() => this.#stopActiveRun()}"
          >
            <icon-mdi-stop class="group-hover:text-chartsRed"></icon-mdi-stop>
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
          : html`<p class="text-disabledForeground text-sm px-4 py-2">
              No tests found
            </p>`}
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
