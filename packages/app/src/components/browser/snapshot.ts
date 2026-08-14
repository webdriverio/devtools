import { Element } from '@core/element'
import scrollbarStyles from '@core/scrollbars.css?inline'
import { html, nothing } from 'lit'
import { consume } from '@lit/context'
import { snapshotStyles } from './snapshot-styles.js'
import { renderBrowserChrome } from './browser-chrome.js'
import {
  drawElementOverlay,
  clearElementOverlay,
  resolveTestSelector
} from './element-overlay.js'
import { commandPageUrl } from './url-at-timestamp.js'
import { mutationForCommand } from './mutation-at-command.js'
import { imageMime } from './trace-timeline-utils.js'
import { booleanAttributeOn, isBooleanAttribute } from './boolean-attribute.js'

import { type ComponentChildren, h, render, type VNode } from 'preact'
import { customElement, query } from 'lit/decorators.js'
import { transform } from './vnode-transform.js'
import type { SimplifiedVNode } from '@wdio/devtools-script/types'
// Type-only, like the `script/types` import above: the collector owns the
// characterData wire shape (parent ref + child index), so the replay reads it
// from the same declaration that produces it.
import type { TextMutation } from '@wdio/devtools-script/mutations.js'
import type { CommandLog } from '@wdio/devtools-shared'

import {
  mutationContext,
  metadataContext,
  metadataBySessionContext,
  commandContext
} from '../../controller/context.js'
import type { Metadata, MetadataBySession } from '@wdio/devtools-shared'

import '../placeholder.js'
import './screencast-player.js'
import '~icons/mdi/cursor-default-click-outline.js'

const MUTATION_SELECTOR = '__mutation-highlight__'

/** A characterData mutation the collector could address. Older traces (and any
 *  producer that only sets `target`) carry no `childIndex`, and there is no
 *  child to patch without one — patching the parent instead would delete its
 *  element children. */
function isAddressedText(mutation: TraceMutation): mutation is TextMutation {
  return (
    typeof mutation.target === 'string' &&
    typeof mutation.childIndex === 'number'
  )
}

const textChildren = (el: Node) =>
  Array.from(el.childNodes).filter(
    (node): node is Text => node.nodeType === Node.TEXT_NODE
  )

declare global {
  interface WindowEventMap {
    'screencast-ready': CustomEvent<{
      sessionId: string
      startTime?: number
      duration?: number
    }>
  }
}

const COMPONENT = 'wdio-devtools-browser'
@customElement(COMPONENT)
export class DevtoolsBrowser extends Element {
  #vdom = document.createDocumentFragment()
  /** Fields a field-state record has written the `value` PROPERTY of, which is
   *  what separates a dirty replayed field from a pristine one. Weak, and every
   *  replay rebuilds the document, so entries die with the elements they key. */
  #fieldStateApplied = new WeakSet<HTMLElement>()
  #activeUrl?: string
  /** Base64 PNG of the screenshot for the currently selected command, or null. */
  #screenshotData: string | null = null
  /**
   * All recorded videos received from the backend, in arrival order. A new
   * entry is pushed for every browser session (initial + after every
   * reloadSession() call). `startTime`/`duration` (recording first-frame
   * timestamp and total span in ms) drive the scrubber's action markers.
   */
  #videos: Array<{
    sessionId: string
    url: string
    startTime?: number
    duration?: number
  }> = []
  /** Index into #videos of the currently displayed video. */
  #activeVideoIdx = 0
  /**
   * Which view is active in the browser panel.
   * 'video'    — always show the screencast player (default when a recording exists)
   * 'snapshot' — show DOM mutations replay and per-command screenshots
   */
  #viewMode: 'snapshot' | 'video' = 'snapshot'
  /** When on, outline the elements the test interacted with (their command
   *  target selectors) on the replayed page; click a box to copy its locator. */
  #overlayOn = false

  @consume({ context: metadataContext, subscribe: true })
  metadata: Metadata | undefined = undefined

  @consume({ context: metadataBySessionContext, subscribe: true })
  metadataBySession: MetadataBySession | undefined = undefined

  @consume({ context: mutationContext, subscribe: true })
  mutations: TraceMutation[] = []

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  static styles = [...Element.styles, snapshotStyles]

  @query('iframe')
  iframe?: HTMLIFrameElement

  @query('header')
  header?: HTMLIFrameElement

  @query('section')
  section?: HTMLElement

  /** The window events the player handles while connected, as one table so its
   *  registration and its teardown cannot drift. Every handler is a per-instance
   *  arrow field, so the reference removeEventListener gets is the one that was
   *  added — a bound method would produce a new function per call and never
   *  detach. */
  #windowListeners(): ReadonlyArray<readonly [string, EventListener]> {
    return [
      ['resize', this.#handleResize],
      ['window-drag', this.#handleResize],
      ['app-mutation-highlight', this.#highlightMutation],
      ['app-mutation-select', this.#handleMutationSelect],
      ['a11y-highlight', this.#highlightBySelector],
      ['show-command', this.#handleShowCommand],
      ['screencast-ready', this.#handleScreencastReady]
    ]
  }

  async connectedCallback() {
    super.connectedCallback()
    for (const [type, handler] of this.#windowListeners()) {
      window.addEventListener(type, handler)
    }
    await this.updateComplete
  }

  // Lit calls connectedCallback again on every re-connect, so a listener left
  // behind keeps a discarded player working — it still replays into its detached
  // iframe and collects arriving recordings — and makes the re-connected one
  // handle every event twice.
  disconnectedCallback() {
    super.disconnectedCallback()
    for (const [type, handler] of this.#windowListeners()) {
      window.removeEventListener(type, handler)
    }
  }

  #setIframeSize() {
    if (!this.section || !this.header) {
      return
    }
    // Screencast: let the device frame fill the pane and the video object-fit
    // inside it, so the frame spans the column like the mockup regardless of
    // the captured window's aspect ratio. Snapshot mode keeps its aspect-lock
    // (the DOM-replay iframe is scaled to the captured viewport).
    if (this.#viewMode === 'video') {
      this.section.style.width = '100%'
      this.section.style.height = '100%'
      return
    }
    this.#sizeSnapshotToViewport()
  }

  #sizeSnapshotToViewport() {
    const metadata = this.metadata
    if (!this.section || !this.header || !metadata) {
      return
    }

    // viewport may not be serialized yet (race between metadata message and
    // first resize event), or may arrive without dimensions — fall back to
    // sensible defaults so we never throw.
    const viewport = metadata.viewport as
      { width?: number; height?: number } | undefined
    const viewportWidth = viewport?.width || 1280
    const viewportHeight = viewport?.height || 800
    if (!viewportWidth || !viewportHeight) {
      return
    }

    // Defer to next frame so we read post-reflow dimensions on resize events.
    // NB: we deliberately do NOT clear the iframe's inline style first — the rAF
    // below overwrites every property it sets, so the iframe keeps its prior
    // (correct) transform until then. Clearing synchronously here made it paint
    // one frame un-scaled → a zoom flicker on every replayed frame during
    // playback, and let the overlay measure a collapsed/narrow layout.
    requestAnimationFrame(() => {
      if (!this.section || !this.header) {
        return
      }
      const frameSize = this.getBoundingClientRect()
      const headerSize = this.header.getBoundingClientRect()
      const hostStyle = getComputedStyle(this)

      // getBoundingClientRect returns the padding-box; subtract host padding
      // so a height-limited scale doesn't push section.width past the edge.
      const padX =
        parseFloat(hostStyle.paddingLeft || '0') +
        parseFloat(hostStyle.paddingRight || '0')
      const padY =
        parseFloat(hostStyle.paddingTop || '0') +
        parseFloat(hostStyle.paddingBottom || '0')

      const effectiveViewportH = viewportHeight

      const availW = Math.max(0, frameSize.width - padX)
      const availH = Math.max(0, frameSize.height - padY - headerSize.height)
      const scale = Math.max(
        0,
        Math.min(availW / viewportWidth, availH / effectiveViewportH)
      )

      // Keep the frame at full pane size (same as screencast) so toggling
      // between the two modes never resizes it; the replay iframe is scaled to
      // fit and centred horizontally inside the stable frame.
      this.section.style.width = '100%'
      this.section.style.height = '100%'

      // Iframe absent in screenshot/video modes — section sizing above still runs.
      this.#scaleReplayIframe(viewportWidth, viewportHeight, scale)
      // Layout is now settled — the one moment element rects are reliable, so
      // the overlay boxes track the replayed DOM after every step and resize.
      this.#redrawOverlay()
    })
  }

  /** Scale the DOM-replay iframe to the captured viewport. Content taller than
   *  the viewport scrolls INSIDE the iframe — a native page scrollbar at the
   *  page's own edge, like a real browser window — so the player adds no outer
   *  scroll surface and no gutter can appear beside the page. Centering is the
   *  wrapper's job (align-items), so the iframe sits at 0,0 inside the sizer. */
  #scaleReplayIframe(
    viewportWidth: number,
    viewportHeight: number,
    scale: number
  ) {
    if (!this.iframe) {
      return
    }
    this.iframe.style.width = `${viewportWidth}px`
    this.iframe.style.height = `${viewportHeight}px`
    this.iframe.style.transformOrigin = '0 0'
    this.iframe.style.transform = `scale(${scale})`
    this.iframe.style.left = '0px'
    this.iframe.style.top = '0px'
    const sizer = this.iframe.parentElement
    if (sizer) {
      sizer.style.width = `${viewportWidth * scale}px`
      sizer.style.height = `${viewportHeight * scale}px`
    }
  }

  #handleResize = () => this.#setIframeSize()

  #handleMutationSelect = (event: Event) =>
    this.#renderBrowserState((event as CustomEvent<TraceMutation>).detail)

  #handleShowCommand = (event: Event) =>
    this.#renderCommandScreenshot(
      (event as CustomEvent<{ command?: CommandLog }>).detail?.command
    )

  #handleScreencastReady = (event: Event) => {
    const { sessionId, startTime, duration } = (
      event as CustomEvent<{
        sessionId: string
        startTime?: number
        duration?: number
      }>
    ).detail
    this.#videos.push({
      sessionId,
      url: `/api/video/${sessionId}`,
      startTime,
      duration
    })
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

  /** Recording window of the active video — feeds the scrubber's markers. */
  get #activeRecording(): { startTime?: number; duration?: number } {
    const v = this.#videos[this.#activeVideoIdx]
    return { startTime: v?.startTime, duration: v?.duration }
  }

  /** URL for the address bar: in video mode the selected recording's page URL
   *  (looked up by its sessionId), else the snapshot's resolved URL. */
  get #displayUrl(): string | undefined {
    if (this.#viewMode === 'video') {
      const sessionId = this.#videos[this.#activeVideoIdx]?.sessionId
      const sessionUrl = sessionId
        ? this.metadataBySession?.[sessionId]?.url
        : undefined
      return sessionUrl ?? this.#activeUrl ?? this.metadata?.url
    }
    return this.#activeUrl
  }

  async #renderCommandScreenshot(command?: CommandLog) {
    this.#screenshotData = this.#screenshotForCommand(command)
    // Follow the selected command's page in the address bar — commands carry no
    // URL, so resolve it from the navigation active at the command's time.
    if (command) {
      this.#activeUrl =
        commandPageUrl(command, this.commands ?? [], this.mutations ?? []) ??
        this.#activeUrl
    }
    // Switch to snapshot mode so the command snapshot is visible instead of the video.
    this.#viewMode = 'snapshot'
    // DOM time-travel: rebuild the iframe DOM to the command's RESULT state (see
    // #mutationForCommand). #renderBrowserState requestUpdates internally, so
    // only request one here when there's no mutation stream (screenshot fallback).
    const target = mutationForCommand(
      command,
      this.commands ?? [],
      this.mutations ?? []
    )
    if (target) {
      await this.#renderBrowserState(target)
    } else {
      this.requestUpdate()
    }
  }

  // View-mode flips swap the iframe with <img>/<video> and don't fire resize.
  updated() {
    this.#setIframeSize()
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
    const doc = this.iframe?.contentDocument
    const docEl = doc?.documentElement
    if (!doc || !docEl) {
      return
    }

    /**
     * remove script tags from application as we are only interested in the static
     * representation of the page
     */
    ;[...this.#vdom.querySelectorAll('script')].forEach((el) => el.remove())

    // importNode into the iframe's document before replaceChild so adoption
    // happens node-by-node in one document: a cross-document graft makes
    // Chromium silently drop body's first element child (the leading flash row).
    const html = this.#vdom.firstElementChild
    if (!html) {
      return
    }
    doc.replaceChild(doc.importNode(html, true), docEl)

    // Player chrome, not captured content: the replayed page's own scrollbars
    // get the app's styling, so they read as part of the mock browser window.
    const scrollbarSheet = doc.createElement('style')
    scrollbarSheet.textContent = scrollbarStyles
    doc.head?.appendChild(scrollbarSheet)

    this.#setIframeSize()
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
    if (!isAddressedText(mutation)) {
      return
    }
    const el = this.#queryElement(mutation.target)
    if (!el) {
      return
    }
    // Patch the addressed node's data only. Assigning `textContent` on the
    // parent would replace ALL of its children — the element ones included.
    const node = this.#textNodeAt(el, mutation)
    if (!node) {
      return
    }
    node.data = mutation.newTextContent || ''
  }

  /** The Text node a characterData mutation addressed. `childIndex` counts the
   *  CAPTURED parent's childNodes, and the replayed parent can hold fewer (the
   *  player strips the page's `<script>` children), so an index that no longer
   *  lands on a text node falls back to the parent's only one — and to nothing
   *  when several make that ambiguous. */
  #textNodeAt(el: HTMLElement, mutation: TextMutation): Text | undefined {
    const addressed = el.childNodes[mutation.childIndex]
    if (addressed?.nodeType === Node.TEXT_NODE) {
      return addressed as Text
    }
    const texts = textChildren(el)
    return texts.length === 1 ? texts[0] : undefined
  }

  #handleAttributeMutation(mutation: TraceMutation) {
    const name = mutation.attributeName
    if (!name) {
      return
    }

    const el = this.#queryElement(mutation.target!)
    if (!el) {
      return
    }

    if (isBooleanAttribute(name)) {
      this.#applyBooleanAttribute(
        el,
        name,
        booleanAttributeOn(name, mutation.attributeValue)
      )
      return
    }

    // An absent value is the capture's removal signal (`mutations.ts` sends
    // undefined where `getAttribute` read null), and `class=""` is not `class`
    // gone: presence-based selectors and `aria-label` semantics both turn on it.
    if (mutation.attributeValue === undefined) {
      el.removeAttribute(name)
      this.#clearRemovedFieldValue(el, name)
      return
    }

    const value = mutation.attributeValue
    el.setAttribute(name, value)
    // Form-field state lives on the PROPERTY, not just the attribute — mirror it
    // so a replayed input shows the captured value, including a field cleared
    // back to empty.
    if (name === 'value' && 'value' in el) {
      ;(el as HTMLInputElement).value = value
      this.#fieldStateApplied.add(el)
    }
  }

  /** A pristine field's text IS its `value` attribute, so removing the attribute
   *  empties the field — but the property stops tracking it once assigned, and
   *  the snapshot render assigns it. Mirroring the clear restores that coupling,
   *  EXCEPT where a field-state record already set the property: the captured
   *  field was dirty then, and a dirty field keeps its text when the attribute
   *  goes. Only the collector's per-edit records carry that text, so clearing
   *  there would lose what the user actually typed. */
  #clearRemovedFieldValue(el: HTMLElement, name: string) {
    if (name !== 'value' || !('value' in el)) {
      return
    }
    if (this.#fieldStateApplied.has(el)) {
      return
    }
    ;(el as HTMLInputElement).value = ''
  }

  /** Presence IS the state of a boolean attribute, so the captured state is
   *  toggled rather than written — the markup a re-serialization reads then says
   *  what the replayed page shows. `checked` is mirrored onto the property as
   *  well because checkedness stops tracking the attribute once anything sets it
   *  (the captured page's fields arrive as preact property writes); every other
   *  boolean attribute reflects its property, so the toggle moves both. */
  #applyBooleanAttribute(el: HTMLElement, name: string, on: boolean) {
    el.toggleAttribute(name, on)
    if (name === 'checked' && 'checked' in el) {
      ;(el as HTMLInputElement).checked = on
    }
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

    // Before the insertions: a removed TEXT node is matched positionally (see
    // #removeChildren), so a text node added here would be a candidate for it
    // and `el.textContent = 'new'` would replay as the old text plus the new.
    this.#removeChildren(el, mutation)

    // Insert added nodes at their captured position via a detached holder.
    // render(vnode, el) can't append — Preact treats `el` as its render root and
    // reconciles its children, replacing el's first child instead of inserting
    // (which would wipe a real sibling, e.g. body's flash banner).
    const nextRef = mutation.nextSibling
    const candidate = nextRef ? this.#queryElement(nextRef, el) : undefined
    const before = candidate?.parentNode === el ? candidate : null
    mutation.addedNodes.forEach((node) => {
      if (typeof node === 'string') {
        el.insertBefore(document.createTextNode(node), before)
      } else {
        const holder = el.ownerDocument.createElement('div')
        render(transform(node), holder)
        while (holder.firstChild) {
          el.insertBefore(holder.firstChild, before)
        }
      }
    })
  }

  /** Drop what a childList mutation removed. An element is found by its ref; a
   *  removed TEXT node has none — `getRef` yields null for it — so each null
   *  entry drops one text child, in the order the collector reported them. */
  #removeChildren(el: HTMLElement, mutation: TraceMutation) {
    const texts = textChildren(el)
    let next = 0
    mutation.removedNodes.forEach((ref) => {
      if (!ref) {
        texts[next++]?.remove()
        return
      }
      this.#queryElement(ref, el)?.remove()
    })
  }

  #queryElement(ref: string, el?: HTMLElement) {
    const rootElement = el || this.iframe?.contentDocument
    if (!rootElement) {
      return
    }
    return rootElement.querySelector(`*[data-wdio-ref="${ref}"]`) as HTMLElement
  }

  #clearHighlight() {
    this.iframe?.contentDocument
      ?.querySelector(`.${MUTATION_SELECTOR}`)
      ?.remove()
  }

  /** Draw the outline box over an element in the replayed iframe. Takes any DOM
   *  element — the text-locator resolver matches on content, so what it finds
   *  need not be an `HTMLElement`. Spelled `globalThis.Element` because the Lit
   *  base class imported here shadows the DOM one. */
  #outline(el: globalThis.Element) {
    const docEl = this.iframe?.contentDocument
    if (!docEl) {
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
    this.#clearHighlight()
    docEl.body.appendChild(highlight)
  }

  #highlightMutation = (event: Event) => {
    const mutation = (event as CustomEvent<TraceMutation | null>).detail
    if (!mutation) {
      this.#clearHighlight()
      return
    }
    const el = mutation.target ? this.#queryElement(mutation.target) : undefined
    if (el) {
      this.#outline(el)
    }
  }

  /** Outline the element for an a11y-tree locator. Resolved through the same
   *  resolver the forward direction (the element overlay) uses, because the tree
   *  captures text-matched elements as XPath (`//button[contains(., "Login")]`)
   *  that querySelector cannot parse. */
  #highlightBySelector = (ev: Event) => {
    const detail = (ev as CustomEvent<{ selector?: string } | null>).detail
    const docEl = this.iframe?.contentDocument
    if (!docEl) {
      return
    }
    this.#clearHighlight()
    if (!detail?.selector) {
      return
    }
    const el = resolveTestSelector(docEl, detail.selector)
    if (el) {
      this.#outline(el)
    }
  }

  /** Distinct target selectors the test interacted with (each command's first
   *  arg), in order. querySelector filters non-element args (URLs, matcher
   *  strings) at draw time, so this stays permissive. */
  #testSelectors(): string[] {
    const seen = new Set<string>()
    for (const command of this.commands ?? []) {
      // Prefer the captured locator: an assertion's args carry its expected
      // value, not the element it targeted (e.g. `#flash`).
      const arg = command.selector ?? command.args?.[0]
      if (typeof arg === 'string' && arg) {
        seen.add(arg)
      }
    }
    return [...seen]
  }

  // Draws immediately — call only once the iframe has laid out (the sizing rAF
  // in #sizeSnapshotToViewport is the one point that holds for both a replay and
  // a resize; reading element rects any earlier yields pre-layout positions).
  #redrawOverlay() {
    if (!this.#overlayOn) {
      clearElementOverlay(this.iframe)
      return
    }
    drawElementOverlay(this.iframe, this.#testSelectors(), {
      onPick: (selector, label) => this.#pickElement(selector, label),
      onHover: (selector, label) => this.#revealA11yRow(selector, label),
      onLeave: () => this.#revealA11yRow()
    })
  }

  /** Clicking a box: copy the locator, open the A11y tab, and pin its row. */
  #pickElement(selector: string, label: string) {
    this.#copyLocator(selector)
    window.dispatchEvent(
      new CustomEvent('open-dock-tab', { detail: { label: 'A11y' } })
    )
    this.#revealA11yRow(selector, label, true)
  }

  /** Reverse link: ask the A11y tab to highlight the matching row — by selector,
   *  falling back to the element's accessible name. `pin` keeps it highlighted
   *  (click) rather than clearing on mouse-out (hover). */
  #revealA11yRow(selector?: string, label?: string, pin = false) {
    window.dispatchEvent(
      new CustomEvent('a11y-reveal', {
        detail: selector ? { selector, label, pin } : null
      })
    )
  }

  #toggleOverlay() {
    this.#overlayOn = !this.#overlayOn
    this.#redrawOverlay()
    this.requestUpdate()
  }

  #copyLocator(selector: string) {
    navigator.clipboard?.writeText(selector).catch(() => {})
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

    // The replay wiped any overlay boxes; the requestUpdate below runs updated()
    // → #sizeSnapshotToViewport, whose settled rAF redraws them post-layout.
    this.requestUpdate()
  }

  /** Screenshot for the selected command. Assertions (and other snapshot-less
   *  commands) carry none, so fall back to the nearest PRECEDING command's frame
   *  — the page state the assertion observed — instead of a blank preview. */
  #screenshotForCommand(command?: CommandLog): string | null {
    if (!command) {
      return null
    }
    if (command.screenshot) {
      return command.screenshot
    }
    const cmds = this.commands ?? []
    const idx = cmds.indexOf(command)
    for (let i = (idx === -1 ? cmds.length : idx) - 1; i >= 0; i--) {
      if (cmds[i].screenshot) {
        return cmds[i].screenshot!
      }
    }
    return null
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

  /** Compact "element overlay" toggle in the browser chrome. Shown only when
   *  the DOM is replayable; boxes the elements the test interacted with. */
  #renderOverlayToggle(hasMutations: number | null) {
    if (!hasMutations) {
      return nothing
    }
    const on = this.#overlayOn
    return html`<button
      title="Element overlay — outline what the test interacted with"
      @click=${() => this.#toggleOverlay()}
      style="display:inline-grid;place-items:center;width:24px;height:24px;margin:0 8px;flex:none;border-radius:6px;cursor:pointer;border:1px solid var(--vscode-panel-border, #2a2a31);background:${
        on ? 'var(--accent, #ff6a3d)' : 'transparent'
      };color:${
        on ? '#1a0d06' : 'var(--vscode-descriptionForeground, #8b8b96)'
      };"
    >
      <icon-mdi-cursor-default-click-outline
        style="width:14px;height:14px;"
      ></icon-mdi-cursor-default-click-outline>
    </button>`
  }

  #renderViewToggle() {
    if (this.#videos.length === 0) {
      return nothing
    }
    return html`
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
        ${
          this.#videos.length > 1
            ? html`<select
                class="video-select"
                ?disabled=${this.#viewMode !== 'video'}
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
            : nothing
        }
      </div>
    `
  }

  #renderViewport(hasMutations: number | null) {
    if (this.#viewMode === 'video' && this.#activeVideoUrl) {
      const rec = this.#activeRecording
      return html`<div class="iframe-wrapper">
        <wdio-devtools-screencast-player
          src=${this.#activeVideoUrl}
          .startTime=${rec.startTime}
          .duration=${rec.duration}
        ></wdio-devtools-screencast-player>
      </div>`
    }
    // DOM replay is the primary snapshot whenever the trace carries mutations:
    // #renderBrowserState reconstructs the iframe DOM at the selected command's
    // time, so points without a captured frame (assertions, static waits) still
    // show the real page instead of a blank/stale screenshot.
    if (hasMutations) {
      return html`<div class="iframe-wrapper iframe-wrapper--replay">
        <div class="iframe-sizer">
          <iframe class="origin-top-left"></iframe>
        </div>
      </div>`
    }
    // No mutation stream (DOM-less / foreign trace): fall back to the selected
    // command's screenshot, then the latest available frame.
    if (this.#screenshotData) {
      return html`<div class="iframe-wrapper">
        <div
          class="screenshot-overlay"
          style="position:relative;flex:1;min-height:0;"
        >
          <img
            src="data:${imageMime(this.#screenshotData)};base64,${
              this.#screenshotData
            }"
          />
        </div>
      </div>`
    }
    const autoScreenshot = this.#latestAutoScreenshot
    if (autoScreenshot) {
      return html`<div class="iframe-wrapper">
        <div
          class="screenshot-overlay"
          style="position:relative;flex:1;min-height:0;"
        >
          <img
            src="data:${imageMime(autoScreenshot)};base64,${autoScreenshot}"
          />
        </div>
      </div>`
    }
    return html`<wdio-devtools-placeholder
      style="height: 100%"
    ></wdio-devtools-placeholder>`
  }

  render() {
    // Render the initial browser state lazily on first mutation arrival.
    if (this.mutations && this.mutations.length && !this.#activeUrl) {
      this.#setIframeSize()
      this.#renderBrowserState()
    }
    const hasMutations = this.mutations && this.mutations.length
    return html`
      <section
        class="w-full h-full bg-sideBarBackground rounded-[14px] border-2 border-panelBorder"
      >
        ${renderBrowserChrome(
          this.#displayUrl,
          html`${this.#renderOverlayToggle(
            hasMutations
          )}${this.#renderViewToggle()}`
        )}
        ${this.#renderViewport(hasMutations)}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: DevtoolsBrowser
  }
}
