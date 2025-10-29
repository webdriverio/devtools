import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'

const TABS_COMPONENT = 'wdio-devtools-tabs'
@customElement(TABS_COMPONENT)
export class DevtoolsTabs extends Element {
  #activeTab: string | undefined
  #tabList: string[] = []

  @property({ type: String })
  cacheId?: string

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        flex-grow: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        color: var(--vscode-foreground);
        background-color: var(--vscode-editor-background);
      }
    `
  ]

  #getTabButton(tabId: string) {
    return html`
      <button
        @click="${() => this.activateTab(tabId)}"
        class="transition-colors px-4 py-2 hover:bg-toolbarHoverBackground ${this
          .#activeTab === tabId
          ? 'bg-toolbarHoverBackground'
          : ''}"
      >
        ${tabId}
      </button>
    `
  }

  get tabs() {
    if (!this.shadowRoot) {
      return []
    }
    const slot = [...Array.from(this.shadowRoot.querySelectorAll('slot'))].find(
      (s) => !s.hasAttribute('name')
    )
    if (!slot) {
      return []
    }
    return slot.assignedElements({ flatten: true }) as Element[]
  }

  get updateComplete(): Promise<boolean> {
    return super.updateComplete.then(() => {
      const tab = this.querySelector(`[slot="${this.#activeTab}"]`)
      if (tab) {
        tab.setAttribute('active', '')
      }
      return true
    })
  }

  activateTab(tabId: string) {
    const activeTab = this.tabs.find((el) => el.getAttribute('label') === tabId)
    if (!activeTab) {
      return
    }
    this.#activeTab = tabId
    this.tabs.forEach((el) => el.removeAttribute('active'))
    activeTab?.setAttribute('active', '')
    this.requestUpdate()

    /**
     * cache tab id in local storage
     */
    if (this.cacheId) {
      localStorage.setItem(this.cacheId, tabId)
    }
  }

  connectedCallback() {
    super.connectedCallback()
    setTimeout(() => {
      // wait till innerHTML is parsed
      this.#tabList =
        this.tabs
          .map((el) => el.getAttribute('label') as string)
          .filter(Boolean) || []

      /**
       * get tab id either from local storage or a tab element that
       * has an "active" attribute
       */
      this.#activeTab =
        (this.cacheId && localStorage.getItem(this.cacheId)) ||
        this.tabs
          .find((el) => el.hasAttribute('active'))
          ?.getAttribute('label') ||
        undefined

      /**
       * set active tab or first tab as active
       */
      if (!this.#activeTab) {
        this.#activeTab = this.#tabList[0]
        this.tabs[0].setAttribute('active', '')
      } else {
        this.activateTab(this.#activeTab)
      }

      this.requestUpdate()
    })
  }

  render() {
    return html`
      ${this.#tabList.length
        ? html`
            <nav class="flex w-full bg-sideBarBackground shadow-md z-10">
              ${this.#tabList.map((tab) => this.#getTabButton(tab))}
              <slot name="actions"></slot>
            </nav>
          `
        : nothing}
      <slot></slot>
    `
  }
}

const TAB_COMPONENT = 'wdio-devtools-tab'
@customElement(TAB_COMPONENT)
export class DevtoolsTab extends Element {
  static styles = [
    ...Element.styles,
    css`
      :host {
        display: none;
        flex-grow: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-width: none;
      }

      :host([active]) {
        display: flex;
      }
    `
  ]

  render() {
    return html` <slot></slot> `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [TABS_COMPONENT]: DevtoolsTabs
    [TAB_COMPONENT]: DevtoolsTab
  }
}
