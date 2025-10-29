import { LitElement, unsafeCSS } from 'lit'

import coreStyles from './core.css?inline'

export class Element extends LitElement {
  static styles = [unsafeCSS(coreStyles)]

  /**
   * get shadow root of element as promise which gets resolved once the element
   * is connected to the DOM
   */
  async getShadowRootAsync() {
    await this.updateComplete
    return this.shadowRoot
  }
}
