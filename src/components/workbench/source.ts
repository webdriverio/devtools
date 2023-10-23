import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

const doc = `function greet(who) {
  return "Hello, " + who;
}`

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
        doc
      })
      container.replaceWith(editorView.dom)
    })
  }

  render() {
    return html`<section class="p-2">loading...</section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
