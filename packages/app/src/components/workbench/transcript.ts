import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import type { CommandLog } from '@wdio/devtools-shared'
import { transcriptContext, commandContext } from '../../controller/context.js'

import '../placeholder.js'
import '~icons/mdi/content-copy.js'
import '~icons/mdi/check.js'

const COMPONENT = 'wdio-devtools-transcript'

/** Player-only panel: renders the run's `transcript.md` and offers a one-click
 *  "Copy prompt" that bundles the transcript with any failing-command errors —
 *  paste-ready context for an LLM. */
@customElement(COMPONENT)
export class DevtoolsTranscript extends Element {
  @consume({ context: transcriptContext, subscribe: true })
  transcript: string | undefined = undefined

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  @state()
  private copied = false

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: auto;
      }
      button {
        position: absolute;
        top: 10px;
        right: 14px;
        z-index: 2;
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-descriptionForeground);
        cursor: pointer;
        font-size: 14px;
      }
      button:hover {
        border-color: var(--accent);
        color: var(--vscode-foreground);
      }
      button.copied {
        color: var(--vscode-charts-green);
        border-color: var(--vscode-charts-green);
      }
      pre {
        margin: 0;
        padding: 14px 52px 14px 14px;
        font-family: var(--vscode-editor-font-family);
        font-size: 12px;
        line-height: 1.6;
        color: var(--vscode-foreground);
        white-space: pre-wrap;
        word-break: break-word;
      }
    `
  ]

  #errorMessage(command: CommandLog): string {
    const err = command.error
    if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message)
    }
    return String(err)
  }

  /** transcript + a Failures section built from commands carrying an error. */
  #buildPrompt(): string {
    const parts: string[] = []
    if (this.transcript) {
      parts.push(this.transcript.trim())
    }
    const failures = (this.commands ?? []).filter((c) => c.error)
    if (failures.length) {
      parts.push(
        '## Failures\n' +
          failures
            .map((f) => `- ${f.title ?? f.command}: ${this.#errorMessage(f)}`)
            .join('\n')
      )
    }
    return parts.join('\n\n')
  }

  async #copy() {
    try {
      await navigator.clipboard.writeText(this.#buildPrompt())
      this.copied = true
      setTimeout(() => {
        this.copied = false
      }, 1500)
    } catch {
      /* clipboard blocked (no user gesture / permissions) — no-op */
    }
  }

  render() {
    if (!this.transcript) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }
    return html`
      <button
        class=${this.copied ? 'copied' : ''}
        @click=${() => this.#copy()}
        title="Copy the transcript + failures as an LLM prompt"
      >
        ${this.copied
          ? html`<icon-mdi-check></icon-mdi-check>`
          : html`<icon-mdi-content-copy></icon-mdi-content-copy>`}
      </button>
      <pre>${this.transcript}</pre>
      ${nothing}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsTranscript
  }
}
