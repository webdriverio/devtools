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
  const childrenRequired = children || []
  const c = Array.isArray(childrenRequired) ? childrenRequired : [childrenRequired]
  return h(node.type as string, props, ...c.map(transform)) as VNode<{}>
}

const COMPONENT = 'wdio-devtools-browser'
@customElement(COMPONENT)
export class DevtoolsBrowser extends Element {
  #vdom = document.createDocumentFragment()

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
    await this.updateComplete
    this.#setIframeSize()
    this.#handleMutation(this.data.mutations[0])
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
    this.#renderVdom()
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

    const hasRenderedFrame = this.iframe?.contentDocument?.documentElement
      .querySelectorAll('*').length === 2 // only body and head are in an empty iframe
    const doc = mutation.addedNodes[0]
    if (hasRenderedFrame && typeof doc !== 'string') {
      return this.#renderNewDocument(doc)
    }

    // TODO: handle mutations
  }

  #highlightMutation (ev: CustomEvent<TraceMutation>) {
    const mutation = ev.detail
    const docEl = this.iframe?.contentDocument
    if (!docEl) {
      return
    }
    const el = docEl.querySelector(`*[data-wdio-ref="${mutation.target}"]`) as HTMLElement
    if (!el) {
      return
    }

    const rect = el.getBoundingClientRect()
    const scrollY = this.iframe?.contentWindow?.scrollY || 0
    const scrollX = this.iframe?.contentWindow?.scrollX || 0

    const highlight = document.createElement('div')
    highlight.setAttribute('class', MUTATION_SELECTOR)
    highlight.setAttribute('style', `position: absolute; background: #38bdf8; outline: 2px dotted red; opacity: .2; top: ${scrollY + rect.top}px; left: ${scrollX + rect.left}px; width: ${rect.width}px; height: ${rect.height}px; z-index: 10000;`)
    docEl.querySelector(`.${MUTATION_SELECTOR}`)?.remove()
    docEl.body.appendChild(highlight)
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
            ${this.data.metadata.url}
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
