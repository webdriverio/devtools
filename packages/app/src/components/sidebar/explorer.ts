import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement } from 'lit/decorators.js'

import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/eye.js'
import '~icons/mdi/collapse-all.js'

import './test-suite.js'
import type { DevtoolsSidebarFilter } from './filter.js'

const EXPLORER = 'wdio-devtools-sidebar-explorer'

interface TestEntry {
  state?: string
  label: string
  children: TestEntry[]
}

const BOILERPLATE_LIST: TestEntry[] = [{
  state: 'failed',
  label: 'example.e2e.ts',
  children: [{
    label: 'should have done this',
    children: [{
      label: 'should have done this',
      children: [{
        label: 'should have done this',
        children: [{
          label: 'should have done this',
          children: [{
            label: 'should have done this',
            children: []
          }]
        }]
      }]
    }]
  }, {
    label: 'should have done this',
    children: []
  }, {
    label: 'should have done this',
    children: []
  }, {
    label: 'should have done this',
    children: []
  }]
}, {
  state: 'passed',
  label: 'example.e2e.ts',
  children: []
}, {
  state: 'failed',
  label: 'example.e2e.ts',
  children: []
}, {
  state: 'skipped',
  label: 'example.e2e.ts',
  children: []
}, {
  state: 'running',
  label: 'example.e2e.ts',
  children: []
,
}]

@customElement(EXPLORER)
export class DevtoolsSidebarExplorer extends Element {
  static styles = [...Element.styles, css`
    :host {
      width: 100%;
      display: block;
    }
  `]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-test-filter', this.#filterTests.bind(this))
  }

  #filterTests ({ detail }: { detail: DevtoolsSidebarFilter }) {
    console.log(detail.filterStatus)
  }

  #renderEntry (entry: TestEntry): TemplateResult {
    return html`
      <wdio-test-entry state="${entry.state as any}">
        <label slot="label">${entry.label}</label>
        ${entry.children && entry.children.length ?
          html`
            <wdio-test-suite slot="children">${entry.children.map(this.#renderEntry.bind(this))}</wdio-test-suite>
          `
          : nothing
        }
      </wdio-test-entry>
    `
  }

  render() {
    return html`
      <header class="pl-4 py-2 flex shadow-md pr-2">
        <h3 class="flex content-center flex-wrap uppercase font-bold text-sm">Tests</h3>
        <nav class="flex ml-auto">
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-play class="group-hover:text-chartsGreen"></icon-mdi-play></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-stop class="group-hover:text-chartsRed"></icon-mdi-stop></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-eye class="group-hover:text-chartsYellow"></icon-mdi-eye></button>
          <button class="p-1 rounded hover:bg-toolbarHoverBackground text-sm group"><icon-mdi-collapse-all class="group-hover:text-chartsBlue"></icon-mdi-collapse-all></button>
        </nav>
      </header>
      <wdio-test-suite>
        ${BOILERPLATE_LIST.map(this.#renderEntry.bind(this))}
      </wdio-test-suite>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [EXPLORER]: DevtoolsSidebarExplorer
  }
}
