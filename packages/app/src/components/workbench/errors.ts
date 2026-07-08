import { Element } from '@core/element'
import { html, css, nothing, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { CommandLog } from '@wdio/devtools-shared'
import { commandContext, suiteContext } from '../../controller/context.js'
import type { SuiteStatsFragment } from '../../controller/types.js'
import { collectErrors, type CollectedError } from './errors/collect.js'

const COMPONENT = 'wdio-devtools-errors'

/** Last three path segments of a `file:line:col` source, so the label stays
 *  short (`step-definitions/steps.ts:31:3`) instead of an absolute path. */
function shortSource(callSource: string): string {
  return callSource.split(/[\\/]/).slice(-3).join('/')
}

@customElement(COMPONENT)
export class DevtoolsErrors extends Element {
  @consume({ context: commandContext, subscribe: true })
  @state()
  commands: CommandLog[] | undefined = undefined

  @consume({ context: suiteContext, subscribe: true })
  @state()
  suites: Record<string, SuiteStatsFragment>[] | undefined = undefined

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
        overflow-y: auto;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-foreground);
      }

      .error-entry {
        border-bottom: 1px solid var(--vscode-panel-border);
        border-left: 2px solid var(--vscode-charts-red);
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Clickable source anchor (@ path:line) — the affordance that opens the
         Source tab at the exact line. Styled as a link, not selected text. */
      .error-loc {
        align-self: flex-start;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        font-weight: 600;
        color: var(--accent);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 3px;
      }
      .error-loc:hover {
        text-decoration-style: solid;
      }
      .error-loc:focus-visible {
        outline: 1px solid var(--accent);
        outline-offset: 2px;
        border-radius: 2px;
      }

      .error-title {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--vscode-charts-red);
        word-break: break-word;
        white-space: pre-wrap;
      }

      /* Aligned key/value block, like the reference viewer's Expected/Received. */
      .error-diff {
        font-family: var(--vscode-editor-font-family);
        font-size: 11.5px;
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 3px 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .error-diff .label {
        color: var(--vscode-descriptionForeground);
      }
      .error-diff .expected {
        color: var(--vscode-charts-green, #3fb950);
      }
      .error-diff .received {
        color: var(--vscode-charts-red);
      }

      .error-stack {
        margin: 2px 0 0;
      }
      .error-stack summary {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        user-select: none;
      }
      .error-stack pre {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--vscode-descriptionForeground);
        max-height: 200px;
        overflow: auto;
        margin: 6px 0 0;
      }

      .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: var(--vscode-descriptionForeground);
      }
      .empty-state-icon {
        font-size: 40px;
        opacity: 0.3;
      }
      .empty-state-text {
        font-size: 14px;
        opacity: 0.6;
      }
    `
  ]

  // Only the source anchor is interactive — it opens the Source tab at the exact
  // line (app-source-highlight activates the tab + scrolls). The entry itself has
  // no click action.
  #openSource(callSource: string) {
    window.dispatchEvent(
      new CustomEvent('app-source-highlight', { detail: callSource })
    )
  }

  #renderDiff(error: CollectedError): TemplateResult | typeof nothing {
    if (error.expected === undefined && error.actual === undefined) {
      return nothing
    }
    return html`<div class="error-diff">
      ${error.expected !== undefined
        ? html`<span class="label">Expected</span
            ><span class="expected">${error.expected}</span>`
        : nothing}
      ${error.actual !== undefined
        ? html`<span class="label">Received</span
            ><span class="received">${error.actual}</span>`
        : nothing}
    </div>`
  }

  #renderEntry(error: CollectedError): TemplateResult {
    return html`
      <div class="error-entry">
        ${error.callSource
          ? html`<button
              class="error-loc"
              title="Open source at this line"
              @click="${() => this.#openSource(error.callSource!)}"
            >
              @${shortSource(error.callSource)}
            </button>`
          : nothing}
        <div class="error-title">${error.message}</div>
        ${this.#renderDiff(error)}
        ${error.stack
          ? html`<details class="error-stack">
              <summary>Stack</summary>
              <pre>${error.stack}</pre>
            </details>`
          : nothing}
      </div>
    `
  }

  render() {
    const errors = collectErrors(this.commands, this.suites)
    if (!errors.length) {
      return html`
        <div class="empty-state">
          <div class="empty-state-icon">✓</div>
          <div class="empty-state-text">No errors</div>
        </div>
      `
    }
    return html`${errors.map((error) => this.#renderEntry(error))}`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsErrors
  }
}
