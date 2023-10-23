import { Element } from '@core/element'
import { html, css } from "lit";
import { customElement } from "lit/decorators.js";

import './tabs.js'

@customElement("wdio-devtools-workbench")
export class DevtoolsWorkbench extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      height: 100%;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      justify-content: center;
      align-items: center;
    }
  `]

  render() {
    return html`
      <section class="flex h-[70%] w-full">
        <div class="w-[50%]">Welcome to the WebdriverIO Devtools</div>
        <div class="text-gray-500">Select a test file to get started</div>
      </section>
      <wdio-devtools-tabs>
        <wdio-devtools-tab label="Source">
          Source tab not yet implemented!
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Log">
          Log tab not yet implemented!
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Console">
          Console tab not yet implemented!
        </wdio-devtools-tab>
        <wdio-devtools-tab label="Network">
          Network tab not yet implemented!
        </wdio-devtools-tab>
      </wdio-devtools-tabs>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wdio-devtools-content": DevtoolsWorkbench;
  }
}
