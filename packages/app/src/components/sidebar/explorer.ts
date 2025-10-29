import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { TestStats, SuiteStats } from '@wdio/reporter'
import { repeat } from 'lit/directives/repeat.js'
import { TestState } from './test-suite.js'
import { suiteContext } from '../../controller/DataManager.js'

import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/eye.js'
import '~icons/mdi/collapse-all.js'
import '~icons/mdi/expand-all.js'

import './test-suite.js'
import { CollapseableEntry } from './collapseableEntry.js'
import type { DevtoolsSidebarFilter } from './filter.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'

interface TestEntry {
  uid: string
  state?: string
  label: string
  callSource?: string
  children: TestEntry[]
}

@customElement(EXPLORER)
export class DevtoolsSidebarExplorer extends CollapseableEntry {
  #testFilter: DevtoolsSidebarFilter | undefined

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

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-test-filter', this.#filterTests.bind(this))
  }

  #filterTests({ detail }: { detail: DevtoolsSidebarFilter }) {
    this.#testFilter = detail
    this.requestUpdate()
  }

  #renderEntry(entry: TestEntry): TemplateResult {
    return html`
      <wdio-test-entry
        state="${entry.state as any}"
        call-source="${entry.callSource || ''}"
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
          (entry.state === TestState.PASSED &&
            this.#testFilter.filtersPassed) ||
          (entry.state === TestState.FAILED &&
            this.#testFilter.filtersFailed) ||
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
        state: entry.tests.some((t) => !t.end)
          ? TestState.RUNNING
          : entry.tests.find((t) => t.state === 'failed')
            ? TestState.FAILED
            : TestState.PASSED,
        callSource: (entry as any).callSource,
        children: Object.values(entries)
          .map(this.#getTestEntry.bind(this))
          .filter(this.#filterEntry.bind(this))
      }
    }
    return {
      uid: entry.uid,
      label: entry.title,
      state: !entry.end
        ? TestState.RUNNING
        : entry.state === 'failed'
          ? TestState.FAILED
          : TestState.PASSED,
      callSource: (entry as any).callSource,
      children: []
    }
  }

  render() {
    if (!this.suites) {
      return
    }

    // ✅ Only root suites (no parent = true top-level suite)
    const rootSuites = this.suites
      .flatMap((s) => Object.values(s))
      .filter((suite) => !suite.parent)

    // Deduplicate by uid (in case some frameworks still push duplicates)
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
          >
            <icon-mdi-play class="group-hover:text-chartsGreen"></icon-mdi-play>
          </button>
          <button
            class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"
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
