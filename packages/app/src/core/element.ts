import { LitElement, unsafeCSS } from 'lit'

import coreStyles from './core.css?inline'
import tailwindStyles from '../tailwind.css?inline'

export class Element extends LitElement {
  static styles = [unsafeCSS(tailwindStyles), unsafeCSS(coreStyles)]

  /**
   * get shadow root of element as promise which gets resolved once the element
   * is connected to the DOM
   */
  async getShadowRootAsync() {
    await this.updateComplete
    return this.shadowRoot
  }
}
