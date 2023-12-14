import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { EditorView, basicSetup } from 'codemirror'
import type { EditorViewConfig } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

import { sourceContext } from '../../controller/DataManager.js'

import '../placeholder.js'

const SOURCE_COMPONENT = 'wdio-devtools-source'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
    }

    .cm-editor {
      width: 100%;
      padding: 10px 0px;
    }
    .cm-content {
      padding: 0!important;
    }
  `]

  @consume({ context: sourceContext, subscribe: true })
  sources: Record<string, string> = {}

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('app-source-highlight', this.#highlightCallSource.bind(this))
  }

  #renderEditor (filePath: string, highlightLine?: number) {
    if (!this.sources) {
      return
    }

    const source = this.sources[filePath]
    if (!source) {
      return
    }

    const container = this.shadowRoot?.querySelector('section') || this.shadowRoot?.querySelector('.cm-editor')
    if (!container) {
      return
    }

    const opts: EditorViewConfig = {
      root: this.shadowRoot!,
      extensions: [basicSetup, javascript(), oneDark],
      doc: source,
      selection: { anchor: 4 }
    }
    const editorView = new EditorView(opts)
    container.replaceWith(editorView.dom)

    /**
     * highlight line of call source
     */
    const lines = [...(this.shadowRoot?.querySelectorAll('.cm-line') || [])]
    if (highlightLine && lines.length && highlightLine < lines.length) {
      setTimeout(() => {
        lines[highlightLine].classList.add('cm-activeLine')
      }, 100)
    }
  }

  #highlightCallSource (ev: CustomEvent<string>) {
    const [filePath, line] = ev.detail.split(':')
    this.#renderEditor(filePath, parseInt(line, 10) + 1)
  }

  render() {
    const sourceFileNames = Object.keys(this.sources || {})
    if (sourceFileNames.length === 0) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }

    this.#renderEditor(sourceFileNames[0])
    return html`
      <section class="p-2">loading...</section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
