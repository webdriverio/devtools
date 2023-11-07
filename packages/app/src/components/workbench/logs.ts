import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

import { context, type TraceLog } from '../../context.js'

const SOURCE_COMPONENT = 'wdio-devtools-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  @consume({ context })
  data: TraceLog = {} as TraceLog

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

  connectedCallback(): void {
    super.connectedCallback()
    setTimeout(() => {
      const container = this.shadowRoot?.querySelector('section')
      if (!container) {
        return
      }
      const editorView = new EditorView({
        root: this.shadowRoot!,
        extensions: [basicSetup, javascript(), oneDark],
        doc: this.data.logs.join('\n')
      })
      container.replaceWith(editorView.dom)
    })
  }

  render() {
    return html`<section class="p-2">loading...</section>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
