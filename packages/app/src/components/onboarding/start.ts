import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { TraceLog } from '@wdio/devtools-hook/types'

const CONFIG_CODE_EXAMPLE = `export const config = {
  // ...
  services: ['devtools'],
  // ...
}`

@customElement('wdio-devtools-start')
export class DevtoolsStart extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
    }
  `]

  @property()
  onLoad = (content: any) => content

  render() {
    return html`
      <div class="h-full flex-1 flex justify-center items-center bg-sideBarBackground">
        <h1 class="border-r-2 pr-12 mr-12 border-panelBorder">
          <img src="/robot.png" width="200px" />
        </h1>
        <section>
          <h2 class="text-4xl font-bold">WebdriverIO Devtools</h2>
          <p class="py-4">
            <h3 class="font-bold text-xl">Load Trace File</h3>
            <input type="file" @change="${this.#loadTraceFile.bind(this)}" />
          </p>
          <p class="py-4">
            <h3 class="font-bold text-xl">Embed into Project</h3>
            First install WebdriverIO Devtools via:
            <pre>npm install @wdio/devtools</pre>
          </p>
          <p class="py-4">
            Then add it as a service:
            <pre class="w-full align-left">${CONFIG_CODE_EXAMPLE}</pre>
          </p>
        </section>
      </div>
    `
  }

  /**
   * Event handler for when a user submits a trace file
   * @param e input file change event
   */
  async #loadTraceFile (e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (!files || files.length === 0) {
      return console.log('no file selected')
    }
    const content = await this.#loadFileContent(files[0])
    this.onLoad(content)
  }

  /**
   * Read trace file and parse it
   * @param file file object from input element
   * @returns parsed TraceLog object
   */
  #loadFileContent (file: File) {
    const reader = new FileReader()
    reader.readAsText(file)
    return new Promise<any | Error>((resolve, reject) => {
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
