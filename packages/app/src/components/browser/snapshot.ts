import { Element } from '@core/element'
import { html, css } from 'lit'
import { consume } from '@lit/context'

import { type ComponentChildren, h, render, type VNode } from 'preact'
import { customElement, query } from 'lit/decorators.js'
import type { SimplifiedVNode } from '../../../../script/types'
import type { CommandLog } from '@wdio/devtools-service/types'

import {
  mutationContext,
  type TraceMutation,
  metadataContext,
  type Metadata
} from '../../controller/DataManager.js'

import '~icons/mdi/world.js'
import '../placeholder.js'

const MUTATION_SELECTOR = '__mutation-highlight__'

function transform(node: any): VNode<{}> {
  if (typeof node !== 'object') {
    return node as VNode<{}>
  }

  const { children, ...props } = node.props
  /**
   * ToDo(Christian): fix way we collect data on added nodes in script
   */
  if (!node.type && children.type) {
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

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  static styles = [
    ...Element.styles,
    css`
      :host {
        width: 100%;
        height: 100%;
        display: flex;
        padding: 2rem;
        align-items: center;
        justify-content: center;
      }

      section {
        box-sizing: border-box;
        width: calc(100% - 0px); /* host padding already applied */
        height: calc(100% - 0px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .frame-dot {
        border-radius: 50%;
        height: 12px;
        width: 12px;
        margin: 1em 0.25em;
        flex-shrink: 0;
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
    await this.updateComplete
  }

  #setIframeSize() {
    const metadata = this.metadata
    if (!this.section || !this.iframe || !this.header || !metadata) {
      return
    }

    this.iframe.removeAttribute('style')
    const viewportWidth = metadata.viewport.width
    const viewportHeight = metadata.viewport.height
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

  async #renderCommandScreenshot(command?: CommandLog) {
    const screenshot = command?.screenshot
    if (!screenshot) {
      return
    }

    if (!this.iframe) {
      await this.updateComplete
    }
    if (!this.iframe) {
      return
    }

    this.iframe.srcdoc = `
      <body style="margin:0;background:#111;display:flex;justify-content:center;align-items:flex-start;">
        <img src="data:image/png;base64,${screenshot}" style="max-width:100%;height:auto;display:block;" />
      </body>
    `
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
      const baseUrl = this.metadata?.url || 'unknown'
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

  render() {
    /**
     * render a browser state if it hasn't before
     */
    if (this.mutations && this.mutations.length && !this.#activeUrl) {
      this.#setIframeSize()
      this.#renderBrowserState()
    }

    return html`
      <section
        class="w-full h-full bg-sideBarBackground rounded-t-md shadow-md"
      >
        <header class="flex block mx-2">
          <div class="frame-dot bg-notificationsErrorIconForeground"></div>
          <div class="frame-dot bg-notificationsWarningIconForeground"></div>
          <div class="frame-dot bg-portsIconRunningProcessForeground"></div>
          <div
            class="flex mx-4 my-2 pr-2 bg-inputBackground text-inputForeground border border-transparent rounded leading-7 w-full"
          >
            <icon-mdi-world class="w-[20px] h-[20px] m-1 mr-2"></icon-mdi-world>
            ${this.#activeUrl}
          </div>
        </header>
        ${this.mutations && this.mutations.length
          ? html`<iframe class="origin-top-left h-full w-full"></iframe>`
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
