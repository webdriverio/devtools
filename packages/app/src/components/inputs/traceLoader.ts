import { Element } from '@core/element'
import { html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { TraceLog } from '@wdio/devtools-service/types'

@customElement('wdio-devtools-trace-loader')
export class DevtoolsTraceLoader extends Element {
  @property({ type: String })
  as: 'input' | 'button' = 'input'

  render() {
    if (this.as === 'button') {
      return html`
        <input
          type="file"
          class="hidden"
          id="loadTraceFile"
          @change="${this.#loadTraceFile.bind(this)}"
        />
        <button class="p-2">
          <label for="loadTraceFile" class="cursor-pointer">
            <icon-mdi-file-upload-outline></icon-mdi-file-upload-outline>
          </label>
        </button>
      `
    }

    return html`
      <input type="file" @change="${this.#loadTraceFile.bind(this)}" />
    `
  }

  /**
   * Event handler for when a user submits a trace file
   * @param e input file change event
   */
  async #loadTraceFile(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (!files || files.length === 0) {
      return console.log('no file selected')
    }
    const content = await this.#loadFileContent(files[0])
    const event = new CustomEvent<TraceLog>('load-trace', {
      detail: content
    })
    window.dispatchEvent(event)
  }

  /**
   * Read trace file and parse it
   * @param file file object from input element
   * @returns parsed TraceLog object
   */
  #loadFileContent(file: File) {
    const reader = new FileReader()
    reader.readAsText(file)
    return new Promise<TraceLog>((resolve, reject) => {
      reader.onload = () => {
        try {
          const content: TraceLog = JSON.parse(reader.result as string)
          if (!content.mutations) {
            throw new Error('Invalid trace file format!')
          }
          return resolve(content)
        } catch (err) {
          return reject(err)
        }
      }
    })
  }
}
