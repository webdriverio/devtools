import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import type { CommandLog } from '@wdio/devtools-hook/types'

import './list.js'

const SOURCE_COMPONENT = 'wdio-devtools-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsSource extends Element {
  @property({ type: Object })
  command?: CommandLog

  @property({ type: Number })
  elapsedTime?: number

  static styles = [...Element.styles, css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('show-command', (ev: CustomEvent) => {
      this.closest('wdio-devtools-tabs')?.activateTab('Log')
      this.command = ev.detail.command
      this.elapsedTime = ev.detail.elapsedTime
    })
  }

  render() {
    if (!this.command) {
      return html`<section class="flex items-center justify-center text-sm w-full h-full">Please select a command to view details!</section>`
    }

    return html`
      <h1 class="border-b-[1px] border-b-panelBorder font-bold p-2">${this.command.command}</h1>
      <wdio-devtools-list
        label="Parameters"
        class="text-xs"
        list="${JSON.stringify(this.command.args)}"></wdio-devtools-list>
      <wdio-devtools-list
        label="Result"
        class="text-xs"
        list="${JSON.stringify(this.command.result)}"></wdio-devtools-list>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsSource
  }
}
