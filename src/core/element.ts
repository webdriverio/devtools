import { LitElement, unsafeCSS } from 'lit'

import coreStyles from './core.css?inline'

export class Element extends LitElement {
  static styles = [unsafeCSS(coreStyles)]
}
