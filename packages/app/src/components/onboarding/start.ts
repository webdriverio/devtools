import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

const CONFIG_CODE_EXAMPLE = `export const config = {
  // ...
  services: ['devtools'],
  // ...
}`

@customElement('wdio-devtools-start')
export class DevtoolsStart extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        width: 100%;
        height: 100%;
      }
    `
  ]

  render() {
    return html`
      <div
        class="h-full flex-1 flex justify-center items-center bg-sideBarBackground"
      >
        <h1 class="border-r-2 pr-12 mr-12 border-panelBorder">
          <img src="/robot.png" width="200px" />
        </h1>
        <section>
          <h2 class="text-4xl font-bold">WebdriverIO Devtools</h2>
          <div class="py-4">
            <h3 class="font-bold text-xl">Embed into Project</h3>
            <p>First install WebdriverIO Devtools via:</p>
            <pre>npm install @wdio/devtools</pre>
          </div>
          <div class="py-4">
            <p>Then add it as a service:</p>
            <pre class="w-full align-left">${CONFIG_CODE_EXAMPLE}</pre>
          </div>
        </section>
      </div>
    `
  }
}
