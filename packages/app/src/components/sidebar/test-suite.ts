import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { CollapseableEntry } from './collapseableEntry.js'
import type { TestRunDetail } from './types.js'
import { TestState } from './types.js'

import '~icons/mdi/chevron-right.js'
import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/eye.js'
import '~icons/mdi/collapse-all.js'
import '~icons/mdi/expand-all.js'
import '~icons/mdi/autorenew.js'
import '~icons/mdi/window-close.js'
import '~icons/mdi/debug-step-over.js'
import '~icons/mdi/check.js'
import '~icons/mdi/checkbox-blank-circle-outline.js'

const TEST_SUITE = 'wdio-test-suite'

@customElement(TEST_SUITE)
export class ExplorerTestSuite extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        height: 100%;
        display: block;
      }
    `
  ]

  render() {
    return html`<slot></slot>`
  }
}

const TEST_ENTRY = 'wdio-test-entry'
@customElement(TEST_ENTRY)
export class ExplorerTestEntry extends CollapseableEntry {
  @property({ attribute: 'is-collapsed' })
  isCollapsed = 'false'

  @property({ type: String })
  uid?: string

  @property({ type: String })
  state?: TestState

  @property({ type: String, attribute: 'call-source' })
  callSource?: string

  @property({ type: String, attribute: 'entry-type' })
  entryType: 'suite' | 'test' = 'suite'

  @property({ type: String, attribute: 'spec-file' })
  specFile?: string

  @property({ type: String, attribute: 'full-title' })
  fullTitle?: string

  @property({ type: String, attribute: 'label-text' })
  labelText?: string

  @property({ type: Boolean, attribute: 'run-disabled' })
  runDisabled = false

  @property({ type: String, attribute: 'run-disabled-reason' })
  runDisabledReason?: string

  @property({ type: String, attribute: 'feature-file' })
  featureFile?: string

  @property({ type: Number, attribute: 'feature-line' })
  featureLine?: number

  @property({ type: String, attribute: 'suite-type' })
  suiteType?: string

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        font-size: 0.8em;
      }
    `
  ]

  #toggleEntry() {
    this.setAttribute('is-collapsed', `${!(this.isCollapsed === 'true')}`)
    const isCollapsed = this.isCollapsed === 'true'
    this.dispatchEvent(
      new CustomEvent('entry-collapse-change', {
        detail: {
          isCollapsed,
          entry: this
        },
        bubbles: true
      })
    )
    if (isCollapsed) {
      this.allowCollapseAll = false
    }
    this.requestUpdate()
  }

  #viewSource() {
    if (!this.callSource) {
      return
    }
    window.dispatchEvent(
      new CustomEvent('app-source-highlight', {
        detail: this.callSource
      })
    )
  }

  #runEntry(event: Event) {
    event.stopPropagation()
    if (!this.uid || this.runDisabled) {
      return
    }
    const detail: TestRunDetail = {
      uid: this.uid,
      entryType: this.entryType,
      specFile: this.specFile,
      fullTitle: this.fullTitle,
      label: this.labelText,
      callSource: this.callSource,
      featureFile: this.featureFile,
      featureLine: this.featureLine,
      suiteType: this.suiteType
    }
    this.dispatchEvent(
      new CustomEvent<TestRunDetail>('app-test-run', {
        detail,
        bubbles: true,
        composed: true
      })
    )
  }

  #stopEntry(event: Event) {
    event.stopPropagation()
    if (!this.uid || this.runDisabled) {
      return
    }
    const detail: TestRunDetail = {
      uid: this.uid,
      entryType: this.entryType,
      specFile: this.specFile,
      fullTitle: this.fullTitle,
      label: this.labelText,
      callSource: this.callSource
    }
    this.dispatchEvent(
      new CustomEvent<TestRunDetail>('app-test-stop', {
        detail,
        bubbles: true,
        composed: true
      })
    )
  }

  get hasPassed() {
    return this.state === TestState.PASSED
  }
  get hasFailed() {
    return this.state === TestState.FAILED
  }
  get hasSkipped() {
    return this.state === TestState.SKIPPED
  }
  get isRunning() {
    return this.state === TestState.RUNNING
  }
  get testStateIcon() {
    if (this.isRunning) {
      return html`<icon-mdi-autorenew
        class="w-4 mt-2 shrink-0 animate-spin"
      ></icon-mdi-autorenew>`
    }
    if (this.hasPassed) {
      return html`<icon-mdi-check
        class="w-4 mt-2 shrink-0 text-chartsGreen"
      ></icon-mdi-check>`
    }
    if (this.hasFailed) {
      return html`<icon-mdi-window-close
        class="w-4 mt-2 shrink-0 text-chartsRed"
      ></icon-mdi-window-close>`
    }
    if (this.hasSkipped) {
      return html`<icon-mdi-debug-step-over
        class="w-4 mt-2 shrink-0 text-chartsYellow"
      ></icon-mdi-debug-step-over>`
    }

    return html`<icon-mdi-checkbox-blank-circle-outline
      class="w-4 mt-2 shrink-0"
    ></icon-mdi-checkbox-blank-circle-outline>`
  }

  render() {
    const hasNoChildren =
      this.querySelectorAll('[slot="children"]').length === 0
    const isCollapsed = this.isCollapsed === 'true'
    const runTooltip = this.runDisabled
      ? this.runDisabledReason ||
        'Single-step execution is controlled by its scenario.'
      : 'Run this entry'

    return html`
      <section class="block mt-2 text-sm flex w-full group/sidebar">
        <button
          class="flex-none pointer px-2 h-8 ${hasNoChildren ? 'hidden' : ''}"
          @click="${() => this.#toggleEntry()}"
        >
          <icon-mdi-chevron-right
            class="text-base transition-transform block ${!isCollapsed
              ? 'block rotate-90'
              : ''}"
          ></icon-mdi-chevron-right>
        </button>
        <span
          class="flex items-start shrink flex-nowrap min-w-0 ${hasNoChildren
            ? 'pl-9'
            : ''}"
        >
          ${this.testStateIcon}
          <slot name="label" class="mx-2 mt-1 block flex-initial shrink"></slot>
        </span>
        <nav
          class="flex-none ml-auto mr-1 transition-opacity opacity-0 group-hover/sidebar:opacity-100"
        >
          ${!this.isRunning
            ? html`
                <button
                  class="p-1 rounded hover:bg-toolbarHoverBackground my-1 group/button ${this
                    .runDisabled
                    ? 'opacity-60 cursor-not-allowed hover:bg-transparent'
                    : ''}"
                  title="${runTooltip}"
                  ?disabled=${this.runDisabled}
                  @click="${(event: Event) => this.#runEntry(event)}"
                >
                  <icon-mdi-play
                    class="${this.runDisabled
                      ? ''
                      : 'group-hover/button:text-chartsGreen'}"
                  ></icon-mdi-play>
                </button>
              `
            : !this.runDisabled
              ? html`
                  <button
                    class="p-1 rounded hover:bg-toolbarHoverBackground my-1 group/button"
                    title="Stop run"
                    @click="${(event: Event) => this.#stopEntry(event)}"
                  >
                    <icon-mdi-stop
                      class="group-hover/button:text-chartsRed"
                    ></icon-mdi-stop>
                  </button>
                `
              : nothing}
          <button
            class="p-1 rounded hover:bg-toolbarHoverBackground my-1 group"
            @click="${() => this.#viewSource()}"
          >
            <icon-mdi-eye class="group-hover:text-chartsYellow"></icon-mdi-eye>
          </button>
          ${!hasNoChildren
            ? html`
                <button
                  class="p-1 rounded hover:bg-toolbarHoverBackground my-1 group"
                  @click="${() => this.#toggleEntry()}"
                >
                  ${this.renderCollapseOrExpandIcon(
                    'group-hover:text-chartsBlue'
                  )}
                </button>
              `
            : nothing}
        </nav>
      </section>
      <section class="block ml-4 ${!isCollapsed ? '' : 'hidden'}">
        <slot name="children"></slot>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [TEST_SUITE]: ExplorerTestSuite
    [TEST_ENTRY]: ExplorerTestEntry
  }
}
