import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import './sidebar/filter.js'
import './sidebar/explorer.js'

@customElement('wdio-devtools-sidebar')
export class DevtoolsSidebar extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        flex-shrink: 0;
        color: var(--vscode-foreground);
        background-color: var(--vscode-sideBar-background);
        border-right: 1px solid var(--vscode-panel-border) !important;
        display: flex;
        flex-direction: column;
      }
    `
  ]

  render() {
    return html`
      <wdio-devtools-sidebar-filter></wdio-devtools-sidebar-filter>
      <wdio-devtools-sidebar-explorer></wdio-devtools-sidebar-explorer>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar': DevtoolsSidebar
  }
}
