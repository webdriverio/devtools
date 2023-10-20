import { Element } from '@core/element'
import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'

/**
 * An example element.
 *
 * @slot - This element has a slot
 * @csspart button - The button
 */
@customElement('wdio-devtools-sidebar')
export class DevtoolsSidebar extends Element {
  static styles = [...Element.styles, css`
    :host {
      width: 33%;
      height: 100%;
      color: white;
    }
  `]

  render() {
    return html`
      <b class="p-4">I am a sidebar</b>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-sidebar': DevtoolsSidebar
  }
}
