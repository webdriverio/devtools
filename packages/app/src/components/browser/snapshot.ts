import { Element } from '@core/element'
import { html, css, nothing } from 'lit'
import { consume } from '@lit/context'

import { type ComponentChildren, h, render, type VNode } from 'preact'
import { customElement, query } from 'lit/decorators.js'
import type { SimplifiedVNode } from '../../../../script/types'
import type { CommandLog } from '@wdio/devtools-service/types'

import {
  mutationContext,
  metadataContext,
  commandContext
} from '../../controller/context.js'
import type { Metadata } from '@wdio/devtools-service/types'

import '~icons/mdi/world.js'
import '../placeholder.js'

const MUTATION_SELECTOR = '__mutation-highlight__'

declare global {
  interface WindowEventMap {
    'screencast-ready': CustomEvent<{ sessionId: string }>
  }
}

function transform(node: any): VNode<{}> {
  if (typeof node !== 'object' || node === null) {
    // Plain string/number text node — return as-is for Preact to render as text.
    return node as VNode<{}>
  }

  const { children, ...props } = node.props ?? {}
  /**
   * ToDo(Christian): fix way we collect data on added nodes in script
   */
  if (!node.type && children?.type) {
    return transform(children)
  }

  const childrenRequired = children || []
  const c = Array.isArray(childrenRequired)
    ? childrenRequired
    : [childrenRequired]
  return h(node.type as string, props, ...c.map(transform)) as VNode<{}>
}

const COMPONENT = 'wdio-devtools-browser'
@customElement(COMPONENT)
export class DevtoolsBrowser extends Element {
  #vdom = document.createDocumentFragment()
  #activeUrl?: string
  /** Base64 PNG of the screenshot for the currently selected command, or null. */
  #screenshotData: string | null = null
  /**
   * All recorded videos received from the backend, in arrival order.
   * Each entry is { sessionId, url } — a new entry is pushed for every
   * browser session (initial + after every reloadSession() call).
   */
  #videos: Array<{ sessionId: string; url: string }> = []
  /** Index into #videos of the currently displayed video. */
  #activeVideoIdx = 0
  /**
   * Which view is active in the browser panel.
   * 'video'    — always show the screencast player (default when a recording exists)
   * 'snapshot' — show DOM mutations replay and per-command screenshots
   */
  #viewMode: 'snapshot' | 'video' = 'snapshot'

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        height: 100%;
        display: flex;
        padding: 2rem !important;
        align-items: center;
        justify-content: center;
        box-sizing: border-box !important;
      }

      section {
        box-sizing: border-box;
        width: calc(100% - 0px); /* host padding already applied */
        height: calc(100% - 0px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--vscode-sideBar-background);
        padding: 0.5rem;
        gap: 0;
      }

      .frame-dot {
        border-radius: 50%;
        height: 12px;
        width: 12px;
        margin: 1em 0.25em;
        flex-shrink: 0;
      }

      .frame-dot:nth-child(1) {
        background-color: var(
          --vscode-notificationsErrorIcon-foreground,
          #e51400
        );
      }

      .frame-dot:nth-child(2) {
        background-color: var(
          --vscode-notificationsWarningIcon-foreground,
          #bf8803
        );
      }

      .frame-dot:nth-child(3) {
        background-color: var(
          --vscode-ports-iconRunningProcessForeground,
          #369432
        );
      }

      iframe {
        background-color: white;
        flex: 1;
        border: none;
        border-radius: 0 0 0.5rem 0.5rem;
        min-height: 0;
      }

      .screenshot-overlay {
        position: absolute;
        inset: 0;
        background: #111;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        border-radius: 0 0 0.5rem 0.5rem;
        overflow: hidden;
      }

      .screenshot-overlay img {
        max-width: 100%;
        height: auto;
        display: block;
      }

      .screencast-player {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #111;
        border-radius: 0 0 0.5rem 0.5rem;
        display: block;
      }

      .iframe-wrapper {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .view-toggle {
        display: flex;
        gap: 2px;
        margin-left: 0.5rem;
        flex-shrink: 0;
      }

      .view-toggle button {
        padding: 2px 10px;
        font-size: 11px;
        font-family: inherit;
        border: 1px solid var(--vscode-editorSuggestWidget-border, #454545);
        background: transparent;
        color: var(--vscode-input-foreground, #ccc);
        cursor: pointer;
        border-radius: 3px;
        line-height: 20px;
        transition:
          background 0.1s,
          color 0.1s;
      }

      .view-toggle button.active {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border-color: transparent;
      }

      .video-select {
        font-size: 11px;
        font-family: inherit;
        padding: 2px 4px;
        border: 1px solid var(--vscode-dropdown-border, #454545);
        border-radius: 3px;
        background: var(--vscode-dropdown-background, #3c3c3c);
        color: var(--vscode-dropdown-foreground, #ccc);
        cursor: pointer;
        line-height: 20px;
        margin-left: 4px;
      }
    `
  ]

  @query('iframe')
  iframe?: HTMLIFrameElement

  @query('header')
  header?: HTMLIFrameElement

  @query('section')
  section?: HTMLElement

  async connectedCallback() {
    super.connectedCallback()
    window.addEventListener('resize', this.#setIframeSize.bind(this))
    window.addEventListener('window-drag', this.#setIframeSize.bind(this))
    window.addEventListener(
      'app-mutation-highlight',
      this.#highlightMutation.bind(this)
    )
    window.addEventListener('app-mutation-select', (ev) =>
      this.#renderBrowserState(ev.detail)
    )
    window.addEventListener(
      'show-command',
      this.#handleShowCommand as EventListener
    )
    window.addEventListener(
      'screencast-ready',
      this.#handleScreencastReady as EventListener
    )
    await this.updateComplete
  }

  #setIframeSize() {
    const metadata = this.metadata
    if (!this.section || !this.iframe || !this.header || !metadata) {
      return
    }

    // viewport may not be serialized yet (race between metadata message and
    // first resize event), or may arrive without dimensions — fall back to
    // sensible defaults so we never throw.
    const viewportWidth = (metadata.viewport as any)?.width || 1280
    const viewportHeight = (metadata.viewport as any)?.height || 800
    if (!viewportWidth || !viewportHeight) {
      return
    }

    this.iframe.removeAttribute('style')
    const frameSize = this.getBoundingClientRect()
    const headerSize = this.header.getBoundingClientRect()

    let scale = frameSize.width / viewportWidth
    if (scale > 0.85) {
      /**
       * Make sure we stop scaling at 85% of the viewport width to ensure
       * we keep the aspect ratio. We substract 0.05 to have a bit of a
       * padding
       */
      scale = frameSize.height / viewportHeight - 0.05
    }

    this.section.style.width = `${viewportWidth * scale}px`
    this.section.style.height = `${Math.min(frameSize.height, viewportHeight * scale)}px`
    this.iframe.style.width = `${viewportWidth}px`
    // this.iframe.style.height = `${(Math.min(frameSize.height, viewportHeight * scale) - headerSize.height)}px`
    this.iframe.style.height = `${viewportHeight - headerSize.height / scale}px`
    this.iframe.style.transform = `scale(${scale})`
  }

  #handleShowCommand = (event: Event) =>
    this.#renderCommandScreenshot(
      (event as CustomEvent<{ command?: CommandLog }>).detail?.command
    )

  #handleScreencastReady = (event: Event) => {
    const { sessionId } = (event as CustomEvent<{ sessionId: string }>).detail
    this.#videos.push({ sessionId, url: `/api/video/${sessionId}` })
    // Always show the latest video and switch to video mode automatically
    this.#activeVideoIdx = this.#videos.length - 1
    this.#viewMode = 'video'
    this.requestUpdate()
  }

  #setViewMode(mode: 'snapshot' | 'video') {
    this.#viewMode = mode
    this.requestUpdate()
  }

  #setActiveVideo(idx: number) {
    this.#activeVideoIdx = idx
    this.requestUpdate()
  }

  /** URL of the currently selected video, or null when no videos exist. */
  get #activeVideoUrl(): string | null {
    return this.#videos[this.#activeVideoIdx]?.url ?? null
  }

  async #renderCommandScreenshot(command?: CommandLog) {
    this.#screenshotData = command?.screenshot ?? null
    // Switch to snapshot mode so the command screenshot is visible instead of the video.
    this.#viewMode = 'snapshot'
    this.requestUpdate()
  }

  async #renderNewDocument(doc: SimplifiedVNode, baseUrl: string) {
    const root = transform(doc)
    const baseTag = h('base', { href: baseUrl })
    const head: VNode<{}> | undefined = (root.props.children as VNode[])
      .filter(Boolean)
      .find((node) => node!.type === 'head')
    if (head) {
      head.props.children = [
        baseTag,
        ...(head.props.children as ComponentChildren[])
      ]
    } else {
      const head = h('head', {}, baseTag)
      const docChildren = (root.props.children as ComponentChildren[]) || []
      docChildren.unshift(head)
    }
    render(root, this.#vdom)
  }

  #renderVdom() {
    const docEl = this.iframe?.contentDocument?.documentElement
    if (!docEl) {
      return
    }

    /**
     * remove script tags from application as we are only interested in the static
     * representation of the page
     */
    ;[...this.#vdom.querySelectorAll('script')].forEach((el) => el.remove())
    docEl.ownerDocument.replaceChild(this.#vdom, docEl)
  }

  async #handleMutation(mutation: TraceMutation) {
    if (!this.iframe) {
      await this.updateComplete
    }

    if (mutation.type === 'attributes') {
      return this.#handleAttributeMutation(mutation)
    }
    if (mutation.type === 'childList') {
      return this.#handleChildListMutation(mutation)
    }
    if (mutation.type === 'characterData') {
      return this.#handleCharacterDataMutation(mutation)
    }
  }

  #handleCharacterDataMutation(mutation: TraceMutation) {
    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    el.textContent = mutation.newTextContent || ''
  }

  #handleAttributeMutation(mutation: TraceMutation) {
    if (!mutation.attributeName || !mutation.attributeValue) {
      return
    }

    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    el.setAttribute(mutation.attributeName, mutation.attributeValue || '')
  }

  #handleChildListMutation(mutation: TraceMutation) {
    if (mutation.addedNodes.length === 1 && !mutation.target) {
      // Prefer the URL embedded in the mutation itself (set by the injected script
      // at capture time), then fall back to the already-resolved active URL, and
      // finally to the context metadata URL.  This avoids a race where metadata
      // arrives after the first childList mutation fires #renderNewDocument.
      const baseUrl =
        mutation.url || this.#activeUrl || this.metadata?.url || 'unknown'
      this.#renderNewDocument(
        mutation.addedNodes[0] as SimplifiedVNode,
        baseUrl
      )
      return this.#renderVdom()
    }

    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    mutation.addedNodes.forEach((node) => {
      if (typeof node === 'string') {
        el.appendChild(document.createTextNode(node))
      } else {
        const root = transform(node)
        render(root, el)
      }
    })

    mutation.removedNodes.forEach((ref) => {
      const child = this.#queryElement(ref, el)
      if (child) {
        child.remove()
      }
    })
  }

  #queryElement(ref: string, el?: HTMLElement) {
    const rootElement = el || this.iframe?.contentDocument
    if (!rootElement) {
      return
    }
    return rootElement.querySelector(`*[data-wdio-ref="${ref}"]`) as HTMLElement
  }

  #highlightMutation(ev: CustomEvent<TraceMutation | null>) {
    if (!ev.detail) {
      this.iframe?.contentDocument
        ?.querySelector(`.${MUTATION_SELECTOR}`)
        ?.remove()
      return
    }

    const mutation = ev.detail
    const docEl = this.iframe?.contentDocument
    if (!docEl || !mutation.target) {
      return
    }
    const el = this.#queryElement(mutation.target)
    if (!el) {
      return
    }

    el.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = el.getBoundingClientRect()
    const scrollY = this.iframe?.contentWindow?.scrollY || 0
    const scrollX = this.iframe?.contentWindow?.scrollX || 0

    const highlight = document.createElement('div')
    highlight.setAttribute('class', MUTATION_SELECTOR)
    highlight.setAttribute(
      'style',
      `position: absolute; background: #38bdf8; outline: 2px dotted red; opacity: .2; top: ${scrollY + rect.top}px; left: ${scrollX + rect.left}px; width: ${rect.width}px; height: ${rect.height}px; z-index: 10000;`
    )
    docEl.querySelector(`.${MUTATION_SELECTOR}`)?.remove()
    docEl.body.appendChild(highlight)
  }

  async #renderBrowserState(mutationEntry?: TraceMutation) {
    const mutations = this.mutations
    if (!mutations || !mutations.length) {
      return
    }

    const mutationIndex = mutationEntry ? mutations.indexOf(mutationEntry) : 0
    this.#vdom = document.createDocumentFragment()
    const rootIndex =
      mutations
        .map(
          (m, i) =>
            [
              // is document loaded
              m.addedNodes.length === 1 && Boolean(m.url),
              // index
              i
            ] as const
        )
        .filter(
          ([isDocLoaded, docLoadedIndex]) =>
            isDocLoaded && docLoadedIndex <= mutationIndex
        )
        .map(([, i]) => i)
        .pop() || 0

    this.#activeUrl =
      mutations[rootIndex].url || this.metadata?.url || 'unknown'
    for (let i = rootIndex; i <= mutationIndex; i++) {
      await this.#handleMutation(mutations[i]).catch((err) =>
        console.warn(`Failed to render mutation: ${err.message}`)
      )
    }

    /**
     * scroll changed element into view
     */
    const mutation = mutations[mutationIndex]
    if (mutation.target) {
      const el = this.#queryElement(mutation.target)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }

    this.requestUpdate()
  }

  /** Latest screenshot from any command — auto-updates the preview as tests run. */
  get #latestAutoScreenshot(): string | null {
    if (!this.commands?.length) {
      return null
    }
    for (let i = this.commands.length - 1; i >= 0; i--) {
      if (this.commands[i].screenshot) {
        return this.commands[i].screenshot!
      }
    }
    return null
  }

  render() {
    /**
     * render a browser state if it hasn't before
     */
    if (this.mutations && this.mutations.length && !this.#activeUrl) {
      this.#setIframeSize()
      this.#renderBrowserState()
    }

    const hasMutations = this.mutations && this.mutations.length
    const autoScreenshot = hasMutations ? null : this.#latestAutoScreenshot
    const displayScreenshot = this.#screenshotData ?? autoScreenshot

    return html`
      <section
        class="w-full h-full bg-sideBarBackground rounded-lg border-2 border-panelBorder shadow-xl"
      >
        <header
          class="flex items-center mx-2 bg-sideBarBackground rounded-t-lg"
        >
          <div class="frame-dot bg-notificationsErrorIconForeground"></div>
          <div class="frame-dot bg-notificationsWarningIconForeground"></div>
          <div class="frame-dot bg-portsIconRunningProcessForeground"></div>
          <div
            class="flex items-center mx-4 my-2 pr-2 bg-input-background text-inputForeground border border-editorSuggestWidgetBorder rounded leading-7 flex-1 min-w-0 overflow-hidden"
          >
            <icon-mdi-world
              class="w-[20px] h-[20px] m-1 mr-2 flex-shrink-0"
            ></icon-mdi-world>
            <span class="truncate">${this.#activeUrl}</span>
          </div>
          ${this.#videos.length > 0
            ? html`
                <div class="view-toggle">
                  <button
                    class=${this.#viewMode === 'snapshot' ? 'active' : ''}
                    @click=${() => this.#setViewMode('snapshot')}
                  >
                    Snapshot
                  </button>
                  <button
                    class=${this.#viewMode === 'video' ? 'active' : ''}
                    @click=${() => this.#setViewMode('video')}
                  >
                    Screencast
                  </button>
                  ${this.#videos.length > 1
                    ? html`<select
                        class="video-select"
                        @change=${(e: Event) => {
                          this.#setActiveVideo(
                            Number((e.target as HTMLSelectElement).value)
                          )
                          this.#setViewMode('video')
                        }}
                      >
                        ${this.#videos.map(
                          (_v, i) =>
                            html`<option
                              value=${i}
                              ?selected=${this.#activeVideoIdx === i}
                            >
                              Recording ${i + 1}
                            </option>`
                        )}
                      </select>`
                    : nothing}
                </div>
              `
            : nothing}
        </header>
        ${this.#viewMode === 'video' && this.#activeVideoUrl
          ? html`<div class="iframe-wrapper">
              <video
                class="screencast-player"
                src="${this.#activeVideoUrl}"
                controls
              ></video>
            </div>`
          : this.#screenshotData
            ? html`<div class="iframe-wrapper">
                <div
                  class="screenshot-overlay"
                  style="position:relative;flex:1;min-height:0;"
                >
                  <img src="data:image/png;base64,${this.#screenshotData}" />
                </div>
              </div>`
            : hasMutations
              ? html`<div class="iframe-wrapper">
                  <iframe class="origin-top-left"></iframe>
                </div>`
              : displayScreenshot
                ? html`<div class="iframe-wrapper">
                    <div
                      class="screenshot-overlay"
                      style="position:relative;flex:1;min-height:0;"
                    >
                      <img src="data:image/png;base64,${displayScreenshot}" />
                    </div>
                  </div>`
                : html`<wdio-devtools-placeholder
                    style="height: 100%"
                  ></wdio-devtools-placeholder>`}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsBrowser
  }
}
