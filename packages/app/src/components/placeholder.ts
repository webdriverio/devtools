import { Element } from '@core/element'
import { html, unsafeCSS } from 'lit'
import { customElement } from 'lit/decorators.js'

import placeholderLoadingCSS from 'placeholder-loading/dist/css/placeholder-loading.css?inline'

@customElement('wdio-devtools-placeholder')
export class DevtoolsPlaceholder extends Element {
  static styles = [
    unsafeCSS(placeholderLoadingCSS),
    unsafeCSS(`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .ph-item {
      border: 0;
      height: 100%;
      background-color: transparent;
    }

    .ph-item div {
      opacity: .6;
    }
  `)
  ]

  render() {
    return html`
      <div class="ph-item">
        <div class="ph-col-12">
          <div class="ph-row">
            <div class="ph-col-6 big"></div>
            <div class="ph-col-4 empty big"></div>
            <div class="ph-col-4"></div>
            <div class="ph-col-8 empty"></div>
            <div class="ph-col-6"></div>
            <div class="ph-col-6 empty"></div>
            <div class="ph-col-12"></div>
          </div>
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-placeholder': DevtoolsPlaceholder
  }
}
