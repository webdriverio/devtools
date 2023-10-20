import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * An example element.
 *
 * @slot - This element has a slot
 * @csspart button - The button
 */
@customElement("wdio-devtools-content")
export class DevtoolsContent extends LitElement {
  render() {
    return html` I am a content `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wdio-devtools-content": DevtoolsContent;
  }
}
