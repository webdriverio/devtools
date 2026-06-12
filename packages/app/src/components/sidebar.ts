import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

import './sidebar/filter.js'
import './sidebar/summary.js'
import './sidebar/explorer.js'

@customElement('wdio-devtools-sidebar')
export class DevtoolsSidebar extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        flex-shrink: 0;
        box-sizing: border-box;
        color: var(--vscode-foreground);
        background-color: var(--vscode-sideBar-background);
        border-right: 1px solid var(--vscode-panel-border) !important;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .top {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.75rem 0.75rem 0.875rem;
      }

      wdio-devtools-sidebar-explorer {
        flex: 1 1 auto;
        min-height: 0;
      }
    `
  ]

  render() {
    return html`
      <div class="top">
        <wdio-devtools-sidebar-filter></wdio-devtools-sidebar-filter>
        <wdio-devtools-sidebar-summary></wdio-devtools-sidebar-summary>
      </div>
      <wdio-devtools-sidebar-explorer></wdio-devtools-sidebar-explorer>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar': DevtoolsSidebar
  }
}
