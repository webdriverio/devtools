import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'

import {
  TRACE_FILE_ACCEPT,
  TRACE_OPEN_PHASE_LABEL
} from '../../controller/constants.js'
import type { TraceOpenPhase } from '../../controller/trace-parse-protocol.js'
import { announceTraceFile, takePickedFile } from '../../utils/trace-file.js'

/** Landing screen of the hosted trace player: pick or drop a trace.zip. */
@customElement('wdio-devtools-open-trace')
export class DevtoolsOpenTrace extends Element {
  @property({ type: Boolean }) busy = false
  @property() phase?: TraceOpenPhase
  @property() error?: string

  @state() dragging = false

  @query('input[type="file"]') input?: HTMLInputElement

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        width: 100%;
        height: calc(100% - 40px);
      }

      /* No Tailwind token generates bg-sideBarBackground (#504). */
      .landing {
        background: var(--vscode-sideBar-background);
        color: var(--vscode-foreground);
      }

      .drop {
        border: 2px dashed var(--vscode-panel-border);
        border-radius: 12px;
        padding: 40px 48px;
        text-align: center;
        transition: border-color 120ms;
      }

      .drop.dragging {
        border-color: var(--accent);
      }

      button {
        margin-top: 16px;
        padding: 8px 18px;
        border-radius: 6px;
        background: var(--accent);
        color: var(--accent-foreground);
        font-weight: 600;
        cursor: pointer;
      }

      button:hover {
        background: var(--accent-hover);
      }

      button:disabled {
        opacity: 0.6;
        cursor: progress;
      }

      /* Indeterminate: the reader cannot say how far through a step it is. */
      .progress {
        height: 3px;
        margin-top: 12px;
        overflow: hidden;
        border-radius: 2px;
        background: var(--vscode-panel-border);
      }

      .progress::after {
        content: '';
        display: block;
        width: 40%;
        height: 100%;
        background: var(--accent);
        animation: progress-slide 1.2s ease-in-out infinite;
      }

      @keyframes progress-slide {
        from {
          transform: translateX(-100%);
        }
        to {
          transform: translateX(250%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .progress::after {
          width: 100%;
          animation: none;
          opacity: 0.5;
        }
      }

      .error {
        color: var(--vscode-charts-red);
      }

      .muted {
        color: var(--vscode-descriptionForeground);
      }

      code {
        font-family: var(--vscode-editor-font-family, monospace);
      }
    `
  ]

  #open(file: File | undefined) {
    if (file && !this.busy) {
      announceTraceFile(this, file)
    }
  }

  #onDragOver(event: DragEvent) {
    event.preventDefault()
    this.dragging = true
  }

  #onDragLeave(event: DragEvent) {
    // Moving onto a child fires `dragleave` on the parent too.
    const target = event.currentTarget as Node
    if (!target.contains(event.relatedTarget as Node | null)) {
      this.dragging = false
    }
  }

  #onDrop(event: DragEvent) {
    event.preventDefault()
    // The app also opens files dropped anywhere on the window.
    event.stopPropagation()
    this.dragging = false
    this.#open(event.dataTransfer?.files[0])
  }

  #onPick() {
    this.#open(takePickedFile(this.input))
  }

  #status(): string {
    if (!this.busy) {
      return 'Drop a trace.zip here'
    }
    return this.phase ? TRACE_OPEN_PHASE_LABEL[this.phase] : 'Opening trace…'
  }

  render() {
    return html`
      <div
        class="landing h-full flex-1 flex flex-col justify-center items-center gap-6 p-4"
        @dragover="${this.#onDragOver}"
        @dragleave="${this.#onDragLeave}"
        @drop="${this.#onDrop}"
      >
        <img src="/robot.png" width="120" alt="" />
        <h2 class="text-3xl font-bold">WebdriverIO Trace Viewer</h2>
        <div class="drop ${this.dragging ? 'dragging' : ''}">
          <p class="text-lg" role="status">${this.#status()}</p>
          ${this.busy ? html`<div class="progress"></div>` : nothing}
          <button
            ?disabled="${this.busy}"
            @click="${() => this.input?.click()}"
          >
            Select file
          </button>
          <input
            type="file"
            accept="${TRACE_FILE_ACCEPT}"
            hidden
            @change="${this.#onPick}"
          />
        </div>
        ${
          this.error
            ? html`<p class="error" role="alert">${this.error}</p>`
            : nothing
        }
        <p class="muted text-sm max-w-xl text-center">
          The trace is opened in this browser tab and never leaves your machine.
          To open one offline, run
          <code>npx show-trace trace.zip</code> in a project with WebdriverIO
          DevTools installed.
        </p>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-open-trace': DevtoolsOpenTrace
  }
}
