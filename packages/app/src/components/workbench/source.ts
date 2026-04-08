import { Element } from '@core/element'
import { html, css, type PropertyValues } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { EditorView, basicSetup } from 'codemirror'
import type { EditorViewConfig } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'

import { sourceContext } from '../../controller/context.js'

import '../placeholder.js'

const SOURCE_COMPONENT = 'wdio-devtools-source'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        width: 100%;
        height: 100%;
      }

      .cm-editor {
        width: 100%;
        height: 100%;
        padding: 10px 0px;
        flex: 1;
        min-height: 0;
      }
      .cm-content {
        padding: 0 !important;
      }

      .source-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
    `
  ]

  @consume({ context: sourceContext, subscribe: true })
  @state()
  sources: Record<string, string> = {}

  #editorView?: EditorView
  #activeFile?: string
  #tabObserver?: MutationObserver

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(
      'app-source-highlight',
      this.#highlightCallSource.bind(this)
    )
    // Observe when the containing tab becomes active so CodeMirror can remeasure
    // after having been initialized while the tab was hidden (display:none).
    requestAnimationFrame(() => {
      const tab = this.closest('wdio-devtools-tab')
      if (tab) {
        this.#tabObserver = new MutationObserver(() => {
          if (tab.hasAttribute('active') && this.#editorView) {
            // Force CodeMirror to remeasure and re-render after becoming visible
            requestAnimationFrame(() => {
              this.#editorView?.requestMeasure()
              this.#editorView?.dom.dispatchEvent(new Event('resize'))
            })
          }
        })
        this.#tabObserver.observe(tab, {
          attributes: true,
          attributeFilter: ['active']
        })
      }
    })
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#editorView?.destroy()
    this.#editorView = undefined
    this.#tabObserver?.disconnect()
    this.#tabObserver = undefined
  }

  updated(_changedProperties: PropertyValues<this>) {
    const sourceFileNames = Object.keys(this.sources || {})
    if (sourceFileNames.length === 0) {
      return
    }
    // Respect an explicitly highlighted file; otherwise show the first available
    const targetFile =
      this.#activeFile && this.sources?.[this.#activeFile]
        ? this.#activeFile
        : sourceFileNames[0]
    this.#mountEditor(targetFile)
  }

  #mountEditor(filePath: string, highlightLine?: number) {
    const source = this.sources?.[filePath]
    if (!source) {
      return
    }

    const container =
      this.shadowRoot?.querySelector<HTMLElement>('.source-container')
    if (!container) {
      return
    }

    // Reuse the existing editor if the file hasn't changed
    if (this.#editorView && this.#activeFile === filePath) {
      if (highlightLine && highlightLine > 0) {
        this.#scrollToLine(this.#editorView, highlightLine)
      }
      return
    }

    // Destroy previous editor instance before creating a new one
    this.#editorView?.destroy()

    const opts: EditorViewConfig = {
      root: this.shadowRoot!,
      extensions: [basicSetup, javascript(), oneDark],
      doc: source,
      parent: container
    }
    this.#editorView = new EditorView(opts)
    this.#activeFile = filePath

    // Force a measure on the next frame so CodeMirror can calculate heights
    // correctly — needed when the editor was created while the panel was hidden
    // or before layout was complete.
    requestAnimationFrame(() => this.#editorView?.requestMeasure())

    if (highlightLine && highlightLine > 0) {
      this.#scrollToLine(this.#editorView, highlightLine)
    }
  }

  #scrollToLine(editorView: EditorView, line: number) {
    try {
      const lineInfo = editorView.state.doc.line(line)
      requestAnimationFrame(() => {
        editorView.dispatch({
          selection: { anchor: lineInfo.from },
          effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' })
        })
      })
    } catch {
      /* ignore out-of-range line numbers */
    }
  }

  #highlightCallSource(ev: Event) {
    const [filePath, line] = (ev as CustomEvent<string>).detail.split(':')
    // If the source for this file is already loaded, mount and scroll immediately
    if (this.sources?.[filePath]) {
      this.#mountEditor(filePath, parseInt(line, 10))
    } else {
      // Source not yet available — will be mounted in updated() once it arrives;
      // store desired highlight so we can apply it then.
      this.#activeFile = filePath
    }
    this.closest('wdio-devtools-tabs')?.activateTab('Source')
  }

  render() {
    const sourceFileNames = Object.keys(this.sources || {})
    if (sourceFileNames.length === 0) {
      return html`<wdio-devtools-placeholder></wdio-devtools-placeholder>`
    }

    return html`<div class="source-container"></div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
