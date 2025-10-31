import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-service/types'
import type { CommandEndpoint } from '@wdio/protocols'

import './list.js'

const SOURCE_COMPONENT = 'wdio-devtools-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  #commandDefinition?: CommandEndpoint

  @property({ type: Object })
  command?: CommandLog

  @property({ type: Number })
  elapsedTime?: number

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 200px;
      }
    `
  ]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', async (ev: CustomEvent) => {
      const command = ev.detail.command
      this.elapsedTime = ev.detail.elapsedTime

      const {
        WebDriverProtocol,
        MJsonWProtocol,
        AppiumProtocol,
        ChromiumProtocol,
        SauceLabsProtocol,
        SeleniumProtocol,
        GeckoProtocol,
        WebDriverBidiProtocol
      } = await import('@wdio/protocols')
      const endpoints = Object.values({
        ...WebDriverProtocol,
        ...MJsonWProtocol,
        ...AppiumProtocol,
        ...ChromiumProtocol,
        ...SauceLabsProtocol,
        ...SeleniumProtocol,
        ...GeckoProtocol,
        ...WebDriverBidiProtocol
      }).reduce(
        (acc, endpoint) => {
          for (const cmdDesc of Object.values(endpoint)) {
            acc[cmdDesc.command] = cmdDesc as CommandEndpoint
          }
          return acc
        },
        {} as Record<string, CommandEndpoint>
      )
      this.#commandDefinition = endpoints[command.command]
      this.command = command

      window.dispatchEvent(
        new CustomEvent('app-source-highlight', {
          detail: this.command?.callSource
        })
      )
      this.closest('wdio-devtools-tabs')?.activateTab('Log')
    })
  }

  render() {
    if (!this.command) {
      return html`
        <section class="flex items-center justify-center text-sm w-full h-full">
          Please select a command to view details!
        </section>
      `
    }

    return html`
      <section
        class="flex flex-column border-b-[1px] border-b-panelBorder px-2 py-1"
      >
        <h1 class="font-bold">${this.command.command}</h1>
        ${this.#commandDefinition &&
        html`<a
          class="ml-auto text-xs flex items-center text-textLinkForeground"
          href="${this.#commandDefinition.ref}"
          target="_blank"
          >Reference</a
        >`}
      </section>
      ${this.#commandDefinition &&
      html`
        <wdio-devtools-list
          label="Description"
          class="text-xs"
          .list="${[this.#commandDefinition.description]}"
        >
        </wdio-devtools-list>
      `}
      <wdio-devtools-list
        label="Parameters"
        class="text-xs"
        .list="${(this.command.args || []).reduce(
          (acc: Record<string, unknown>, val: unknown, i: number) => {
            const def = this.#commandDefinition
            const paramName = def?.parameters?.[i]?.name ?? i
            acc[paramName] = val
            return acc
          },
          {} as Record<string, unknown>
        )}"
      ></wdio-devtools-list>
      <wdio-devtools-list
        label="Result"
        class="text-xs"
        .list="${typeof this.command.result === 'object'
          ? this.command.result
          : [this.command.result]}"
      ></wdio-devtools-list>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
