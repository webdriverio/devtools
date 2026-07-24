import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import { CollapseableEntry } from './collapseableEntry.js'
import type { TestRunDetail, TestStatus } from './types.js'
import { TestState } from './types.js'

import '~icons/mdi/menu-down.js'
import '~icons/mdi/play.js'
import '~icons/mdi/stop.js'
import '~icons/mdi/collapse-all.js'
import '~icons/mdi/expand-all.js'
import '~icons/mdi/close.js'
import '~icons/mdi/debug-step-over.js'
import '~icons/mdi/check.js'
import '~icons/mdi/circle-outline.js'
import '~icons/mdi/bug-play.js'

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

/** Compact action button sized to the row's line-height so it never inflates
 *  the row or sits below the title. */
const ACTION_BTN =
  'shrink-0 grid place-items-center w-6 h-[18px] rounded hover:bg-toolbarHoverBackground group/button'
const ACTION_ICON = 'w-[15px] h-[15px]'
@customElement(TEST_ENTRY)
export class ExplorerTestEntry extends CollapseableEntry {
  @property({ attribute: 'is-collapsed' })
  isCollapsed = 'false'

  @property({ type: String })
  uid?: string

  @property({ type: String })
  state?: TestStatus

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

  @property({ type: Boolean, attribute: 'has-children' })
  hasChildren = false

  @property({ type: Boolean, reflect: true })
  selected = false

  @property({ type: Boolean, reflect: true })
  root = false

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        font-size: 12.5px;
      }

      /* The label is slotted, so its size must be set on the slotted node
         directly — :host font-size doesn't reach it. */
      ::slotted(label) {
        font-size: 12.5px;
        /* matches the icon box height so the icon aligns with the first line */
        line-height: 18px;
      }

      :host([selected]) .row {
        background: color-mix(in srgb, var(--accent) 14%, transparent);
        box-shadow: inset 2px 0 0 var(--accent);
      }
      /* a selected row keeps its action buttons visible without hover */
      :host([selected]) .row-actions {
        opacity: 1;
      }

      :host(:not([has-children])) ::slotted(label) {
        color: var(--vscode-descriptionForeground);
      }
      :host([state='running']) ::slotted(label) {
        color: var(--vscode-charts-blue);
      }
      :host([state='failed']) ::slotted(label) {
        color: var(--vscode-charts-red);
      }
      :host([state='skipped']) ::slotted(label) {
        color: var(--vscode-charts-yellow);
      }
      :host([selected]) ::slotted(label) {
        color: var(--vscode-foreground);
      }
      :host([root]) ::slotted(label) {
        color: var(--vscode-foreground);
        font-weight: 600;
      }

      .run-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--vscode-charts-blue);
        animation: run-pulse 1.5s ease-in-out infinite;
      }
      @keyframes run-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.4;
          transform: scale(0.7);
        }
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

  #selectEntry() {
    if (this.uid) {
      this.dispatchEvent(
        new CustomEvent('app-test-select', {
          detail: this.uid,
          bubbles: true,
          composed: true
        })
      )
    }
    this.#viewSource()
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

  #preserveAndRerun(event: Event) {
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
      new CustomEvent<TestRunDetail>('app-test-preserve-rerun', {
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
    // Vertically centred in the row so the status icon lines up with the
    // row's action buttons (run/stop), which are also centre-aligned.
    const box = (inner: unknown) =>
      html`<span
        class="w-4 h-[18px] shrink-0 self-center grid place-items-center"
        >${inner}</span
      >`
    if (this.isRunning) {
      return box(html`<span class="run-dot"></span>`)
    }
    if (this.hasPassed) {
      return box(
        html`<icon-mdi-check class="text-chartsGreen"></icon-mdi-check>`
      )
    }
    if (this.hasFailed) {
      return box(html`<icon-mdi-close class="text-chartsRed"></icon-mdi-close>`)
    }
    if (this.hasSkipped) {
      return box(
        html`<icon-mdi-debug-step-over
          class="text-chartsYellow"
        ></icon-mdi-debug-step-over>`
      )
    }
    return box(
      html`<icon-mdi-circle-outline
        class="text-disabledForeground"
      ></icon-mdi-circle-outline>`
    )
  }

  #renderStopButton() {
    return html`
      <button
        class="${ACTION_BTN}"
        title="Stop run"
        @click="${(event: Event) => this.#stopEntry(event)}"
      >
        <icon-mdi-stop
          class="${ACTION_ICON} group-hover/button:text-chartsRed"
        ></icon-mdi-stop>
      </button>
    `
  }

  #renderRunButton() {
    const runTooltip = this.runDisabled
      ? this.runDisabledReason ||
        'Single-step execution is controlled by its scenario.'
      : 'Run this entry'
    return html`
      <button
        class="${ACTION_BTN} ${this.runDisabled
          ? 'opacity-60 cursor-not-allowed hover:bg-transparent'
          : ''}"
        title="${runTooltip}"
        ?disabled=${this.runDisabled}
        @click="${(event: Event) => this.#runEntry(event)}"
      >
        <icon-mdi-play
          class="${ACTION_ICON} ${this.runDisabled
            ? ''
            : 'group-hover/button:text-chartsGreen'}"
        ></icon-mdi-play>
      </button>
    `
  }

  #renderRunStopButtons() {
    if (this.isRunning) {
      return this.runDisabled ? nothing : this.#renderStopButton()
    }
    return html`
      ${this.#renderRunButton()}
      ${this.hasFailed && !this.runDisabled
        ? html`
            <button
              class="${ACTION_BTN}"
              title="Preserve current run and rerun for comparison"
              @click="${(event: Event) => this.#preserveAndRerun(event)}"
            >
              <icon-mdi-bug-play
                class="${ACTION_ICON} group-hover/button:text-chartsBlue"
              ></icon-mdi-bug-play>
            </button>
          `
        : nothing}
    `
  }

  #renderToolbar(hasNoChildren: boolean) {
    return html`
      <nav
        class="row-actions flex items-center gap-0.5 flex-none self-center ml-auto mr-1 transition-opacity opacity-0 group-hover/sidebar:opacity-100"
      >
        ${this.#renderRunStopButtons()}
        ${!hasNoChildren
          ? html`
              <button
                class="${ACTION_BTN}"
                @click="${() => this.#toggleEntry()}"
              >
                ${this.renderCollapseOrExpandIcon(
                  `${ACTION_ICON} group-hover:text-chartsBlue`
                )}
              </button>
            `
          : nothing}
      </nav>
    `
  }

  render() {
    const hasNoChildren = !this.hasChildren
    const isCollapsed = this.isCollapsed === 'true'
    return html`
      <section
        class="row flex w-full items-start text-sm group/sidebar rounded-md my-0.5 px-1 py-1 cursor-pointer hover:bg-toolbarHoverBackground"
      >
        <button
          class="flex-none pointer px-2 h-[18px] flex items-center justify-center ${hasNoChildren
            ? 'hidden'
            : ''}"
          @click="${() => this.#toggleEntry()}"
        >
          <icon-mdi-menu-down
            class="text-[11px] transition-transform block text-disabledForeground ${isCollapsed
              ? '-rotate-90'
              : ''}"
          ></icon-mdi-menu-down>
        </button>
        <span
          class="flex items-start shrink flex-nowrap min-w-0 leading-[18px] ${hasNoChildren
            ? 'pl-9'
            : ''}"
          @click="${() => this.#selectEntry()}"
        >
          ${this.root ? nothing : this.testStateIcon}
          <slot name="label" class="mx-2 block flex-initial shrink"></slot>
        </span>
        ${this.#renderToolbar(hasNoChildren)}
      </section>
      <section
        class="ml-3 border-l border-panelBorder pl-1 ${!isCollapsed
          ? ''
          : 'hidden'}"
      >
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
