import { Element } from '@core/element'
import { html, css } from 'lit'
import { consume } from '@lit/context'

import { type ComponentChildren, h, render, type VNode } from 'preact'
import { customElement, query } from 'lit/decorators.js'

import { context, type TraceLog } from '../../context.js'

import '~icons/mdi/world.js'

const MUTATION_SELECTOR = '__mutation-highlight__'

function transform (node: any): VNode<{}> {
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
  #activeUrl = ''

  @consume({ context })
  data: TraceLog = {} as TraceLog

  static styles = [...Element.styles, css`
    :host {
      width: 100%;
      height: 100%;
      display: flex;
      margin: 2rem;
      align-items: center;
      justify-content: center;
    }

    .frame-dot {
      border-radius: 50%;
      height: 12px;
      width: 12px;
      margin: 1em .25em;
      flex-shrink: 0;
    }
  `]

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
    window.addEventListener('app-mutation-highlight', this.#highlightMutation.bind(this))
    window.addEventListener('app-mutation-select', (ev) => this.#renderBrowserState(ev.detail))
    await this.updateComplete
    this.#setIframeSize()

    /**
     * Render initial document
     */
    this.#renderBrowserState()
  }

  #setIframeSize () {
    if (!this.section || !this.iframe || !this.header) {
      return
    }

    this.section.style.width = 'auto'
    this.section.style.height = 'auto'

    this.iframe.removeAttribute('style')
    const viewportWidth = this.data.metadata.viewport.width
    const viewportHeight = this.data.metadata.viewport.height
    const frameSize = this.getBoundingClientRect()
    const headerSize = this.header.getBoundingClientRect()

    let scale = frameSize.width / viewportWidth
    if (scale > 0.85) {
      /**
       * Make sure we stop scaling at 85% of the viewport width to ensure
       * we keep the aspect ratio. We substract 0.05 to have a bit of a
       * padding
       */
      scale = (frameSize.height / viewportHeight) - 0.05
    }

    this.section.style.width = `${viewportWidth * scale}px`
    this.section.style.height = `${Math.min(frameSize.height, viewportHeight * scale)}px`
    this.iframe.style.width = `${viewportWidth}px`
    // this.iframe.style.height = `${(Math.min(frameSize.height, viewportHeight * scale) - headerSize.height)}px`
    this.iframe.style.height = `${viewportHeight - (headerSize.height / scale)}px`
    this.iframe.style.transform = `scale(${scale})`
  }

  async #renderNewDocument (doc: SimplifiedVNode) {
    const root = transform(doc)
    const baseTag = h('base', { href: this.data.metadata.url })
    const head: VNode<{}> | undefined = (root.props.children as VNode[])
      .filter(Boolean)
      .find((node) => node!.type === 'head')
    if (head) {
      head.props.children = [
        baseTag,
        ...head.props.children as ComponentChildren[]
      ]
    } else {
      const head = h('head', {}, baseTag)
      const docChildren = root.props.children as ComponentChildren[] || []
      docChildren.unshift(head)
    }
    render(root, this.#vdom)
  }

  #renderVdom () {
    const docEl = this.iframe?.contentDocument?.documentElement
    if (!docEl) {
      return
    }

    /**
     * remove script tags from application as we are only interested in the static
     * representation of the page
     */
    [...this.#vdom.querySelectorAll('script')].forEach((el) => el.remove())
    docEl.ownerDocument.replaceChild(this.#vdom, docEl)
  }

  async #handleMutation (mutation: TraceMutation) {
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

  #handleCharacterDataMutation (mutation: TraceMutation) {
    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    el.textContent = mutation.newTextContent || ''
  }

  #handleAttributeMutation (mutation: TraceMutation) {
    if (!mutation.attributeName || !mutation.attributeValue) {
      return
    }

    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    el.setAttribute(mutation.attributeName, mutation.attributeValue || '')
  }

  #handleChildListMutation (mutation: TraceMutation) {
    if (mutation.addedNodes.length === 1 && !mutation.target) {
      this.#renderNewDocument(mutation.addedNodes[0] as SimplifiedVNode)
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

  #queryElement (ref: string, el?: HTMLElement) {
    const rootElement = el || this.iframe?.contentDocument
    if (!rootElement) {
      return
    }
    return rootElement.querySelector(`*[data-wdio-ref="${ref}"]`) as HTMLElement
  }

  #highlightMutation (ev: CustomEvent<TraceMutation | null>) {
    if (!ev.detail) {
      this.iframe?.contentDocument?.querySelector(`.${MUTATION_SELECTOR}`)?.remove()
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
    highlight.setAttribute('style', `position: absolute; background: #38bdf8; outline: 2px dotted red; opacity: .2; top: ${scrollY + rect.top}px; left: ${scrollX + rect.left}px; width: ${rect.width}px; height: ${rect.height}px; z-index: 10000;`)
    docEl.querySelector(`.${MUTATION_SELECTOR}`)?.remove()
    docEl.body.appendChild(highlight)
  }

  async #renderBrowserState (mutationEntry?: TraceMutation) {
    const mutationIndex = mutationEntry
      ? this.data.mutations.indexOf(mutationEntry)
      : 0
    this.#vdom = document.createDocumentFragment()
    const rootIndex = this.data.mutations
      .map((m, i) => [
        // is document loaded
        m.addedNodes.length === 1 && Boolean(m.url),
        // index
        i
      ] as const)
      .filter(([isDocLoaded, docLoadedIndex]) => isDocLoaded && docLoadedIndex <= mutationIndex)
      .map(([, i]) => i)
      .pop() || 0

    this.#activeUrl = this.data.mutations[rootIndex].url || this.data.metadata.url
    for (let i = rootIndex; i <= mutationIndex; i++) {
      await this.#handleMutation(this.data.mutations[i]).catch(
        (err) => console.warn(`Failed to render mutation: ${err.message}`))
    }

    /**
     * scroll changed element into view
     */
    const mutation = this.data.mutations[mutationIndex]
    if (mutation.target) {
      const el = this.#queryElement(mutation.target)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }

    this.requestUpdate()
  }

  render() {
    return html`
      <section class="w-full bg-sideBarBackground rounded-t-md shadow-md">
        <header class="flex block mx-2">
          <div class="frame-dot bg-notificationsErrorIconForeground"></div>
          <div class="frame-dot bg-notificationsWarningIconForeground"></div>
          <div class="frame-dot bg-portsIconRunningProcessForeground"></div>
          <div class="flex mx-4 my-2 pr-2 bg-inputBackground text-inputForeground border border-transparent rounded leading-7 w-full">
            <icon-mdi-world class="w-[20px] h-[20px] m-1 mr-2"></icon-mdi-world>
            ${this.#activeUrl}
          </div>
        </header>
        <iframe class="origin-top-left"></iframe>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsBrowser
  }
}
