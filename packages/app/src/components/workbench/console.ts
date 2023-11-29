import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { consume } from '@lit/context'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/chevron-right.js'

const BG: Record<ConsoleLogs['type'], string> = {
  'warn': 'editorOverviewRulerWarningForeground',
  'info': 'editorOverviewRulerInfoForeground',
  'error': 'editorOverviewRulerErrorForeground',
  'log': 'panelBorder'
}

const SOURCE_COMPONENT = 'wdio-devtools-console-logs'
@customElement(SOURCE_COMPONENT)
export class DevtoolsConsoleLogs extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      flex-direction: column;
      padding: 5px;
    }
  `]

  @consume({ context })
  data: TraceLog = {} as TraceLog

  render() {
    if (this.data.consoleLogs.length === 0) {
      return html`<section class="flex items-center justify-center text-sm w-full h-full">No events logged!</section>`
    }

    return html`
      ${Object.values(this.data.consoleLogs).map((log) => html`
        <dl class="w-full flex grow-0">
          <dt class="flex">
            <icon-mdi-chevron-right class="text-base transition-transform block"></icon-mdi-chevron-right>
            <span class="block bg-${BG[log.type]} rounded text-sm py-[1px] px-[5px] my-1">${log.type}</span>
          </dt>
          <dd class="flex justify-center items-center mx-2">${log.args}</dd>
        </dl>
      `)}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [SOURCE_COMPONENT]: DevtoolsConsoleLogs
  }
}
