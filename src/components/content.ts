import { Element } from '@core/element'
import { html, css } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("wdio-devtools-content")
export class DevtoolsContent extends Element {
  static styles = [...Element.styles, css`
    :host {
      display: flex;
      flex-grow: 1;
      height: 100%;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      justify-content: center;
      align-items: center;
    }
  `]

  render() {
    return html`I am a content`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wdio-devtools-content": DevtoolsContent;
  }
}
