import { Element } from '@core/element'
import { html, css } from "lit";
import { customElement } from "lit/decorators.js";

import './tabs.js'
import './workbench/source.js'

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
        <section class="min-w-[33%]">
          <wdio-devtools-tabs class="h-full flex flex-col border-r-[1px] border-r-panelBorder">
            <wdio-devtools-tab label="Actions">
              Actions tab not yet implemented!
            </wdio-devtools-tab>
            <wdio-devtools-tab label="Metadata">
              Metadata tab not yet implemented!
            </wdio-devtools-tab>
          </wdio-devtools-tabs>
        </section>
        <section class="text-gray-500 flex items-center justify-center flex-grow">
          Select a test file to get started
        </section>
      </section>
      <wdio-devtools-tabs class="border-t-[1px] border-t-panelBorder">
        <wdio-devtools-tab label="Source">
          <wdio-devtools-source></wdio-devtools-source>
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
