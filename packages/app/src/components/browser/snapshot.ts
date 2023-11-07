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
      padding: 2rem;
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

    this.iframe.removeAttribute('style')
    const frameSize = this.section.getBoundingClientRect()
    const headerSize = this.header.getBoundingClientRect()
    this.iframe.style.width = `${frameSize.width}px`
    this.iframe.style.height = `${frameSize.height - headerSize.height}px`
  }

  async #renderNewDocument (doc: Document) {
    const root = transform(doc)
    const baseTag = h('base', { href: 'https://selenium.dev' })
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
    docEl.ownerDocument.replaceChild(this.#vdom, docEl)
  }

  async #handleMutation (mutation: MutationRecord) {
    if (!this.iframe) {
      await this.updateComplete
    }

    const hasRenderedFrame = this.iframe?.contentDocument?.documentElement
      .querySelectorAll('*').length === 2 // only body and head are in an empty iframe
    if (hasRenderedFrame) {
      return this.#renderNewDocument(mutation.addedNodes[0] as Document)
    }

    // TODO: handle mutations
  }

  #highlightMutation (ev: CustomEvent<MutationRecord>) {
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
            about:blank
          </div>
        </header>
        <iframe></iframe>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsBrowser
  }
}
