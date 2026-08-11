import { Element } from '@core/element'
import { html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

import placeholderLoadingCSS from 'placeholder-loading/dist/css/placeholder-loading.css?inline'

/** Panel filler in one of two modes: a loading skeleton while data is still on
 *  its way, or — once a caller supplies `heading`/`description` — an empty state
 *  that says why the panel has nothing to show. `heading` rather than `title` so
 *  the copy doesn't double as a native tooltip on the host. */
@customElement('wdio-devtools-placeholder')
export class DevtoolsPlaceholder extends Element {
  /** Empty-state glyph, in the same spirit as the panels' own `.empty-state`
   *  blocks (console's `📋`, errors' `✓`). */
  @property({ type: String })
  icon?: string

  @property({ type: String })
  heading?: string

  @property({ type: String })
  description?: string

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

    .empty-state {
      box-sizing: border-box;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #8b8b96);
    }

    .empty-state-icon {
      font-size: 40px;
      line-height: 1;
      opacity: .3;
    }

    .empty-state-text {
      font-size: 14px;
      opacity: .6;
    }

    .empty-state-detail {
      font-size: 12px;
      opacity: .5;
      max-width: 46ch;
      line-height: 1.5;
    }
  `)
  ]

  #skeleton(): TemplateResult {
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

  render() {
    if (!this.heading && !this.description) {
      return this.#skeleton()
    }
    return html`
      <div class="empty-state">
        ${this.icon
          ? html`<div class="empty-state-icon">${this.icon}</div>`
          : nothing}
        ${this.heading
          ? html`<div class="empty-state-text">${this.heading}</div>`
          : nothing}
        ${this.description
          ? html`<div class="empty-state-detail">${this.description}</div>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wdio-devtools-placeholder': DevtoolsPlaceholder
  }
}
