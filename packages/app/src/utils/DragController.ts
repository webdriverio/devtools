import { html } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import type { ReactiveController, ReactiveControllerHost } from 'lit'
// @ts-expect-error see https://github.com/GoogleChromeLabs/pointer-tracker/pull/17
import type { Pointer, InputEvent } from 'pointer-tracker'
// @ts-expect-error see https://github.com/GoogleChromeLabs/pointer-tracker/pull/17
import PointerTracker from 'pointer-tracker'

export enum Direction {
  horizontal = 'horizontal',
  vertical = 'vertical'
}

type DragControllerHost = HTMLElement & ReactiveControllerHost
type AsyncGetElFn = () => Element | Promise<Element | null>

/** Bounds accept getters so panes with a layout-dependent budget clamp live. */
type Bound = number | (() => number)

interface DragControllerOptions {
  /** Accepts a getter, like the bounds: a window-derived default resolved once
   *  at construction never follows the window it was derived from. */
  initialPosition: Bound
  /**
   * Which edge the pane is measured from. `start` (the default) is a pane on
   * the left or top, whose size grows as the handle moves away from that edge.
   * `end` is a pane on the right or bottom: its handle sits on its inner edge,
   * so the position is an offset from the far side and dragging TOWARDS the
   * start makes it bigger.
   */
  anchor?: 'start' | 'end'
  direction: Direction
  localStorageKey?: string
  minPosition?: Bound
  maxPosition?: Bound
  getContainerEl: AsyncGetElFn
}

function resolveBound(bound: Bound | undefined): number | undefined {
  return typeof bound === 'function' ? bound() : bound
}

type State = 'dragging' | 'idle'

const defaultOptions = {
  getContainerEl: () => Promise.resolve(null)
}

export class DragController implements ReactiveController {
  #id = Math.random().toString(36).slice(2, 9)
  #host: DragControllerHost
  #options: DragControllerOptions
  #localStorageKey?: string

  #x = 0
  #y = 0

  #cursorPositionX = 0
  #cursorPositionY = 0

  #containerEl: HTMLElement = null!
  #draggableEl: HTMLElement = null!

  #state: State = 'idle'
  #pointerTracker: PointerTracker | null = null
  /** Whether the current position is the user's own — restored from storage or
   *  dragged — rather than derived from the window. */
  #userChosen = false

  constructor(host: DragControllerHost, options: DragControllerOptions) {
    this.#host = host
    this.#host.addController(this)
    this.#options = Object.assign({}, defaultOptions, options)
    this.#localStorageKey = options.localStorageKey

    Promise.all([this.#getDraggableEl(), options.getContainerEl()]).then(
      ([draggableEl, containerEl]) => {
        if (!draggableEl || !containerEl) {
          // Retry after a short delay. Quietly: a host renders only the sliders
          // its current mode needs, so a handle whose pane is absent is expected
          // — hostUpdated → #maybeReinit picks it up if it ever appears.
          setTimeout(async () => {
            const [retryDraggableEl, retryContainerEl] = await Promise.all([
              this.#getDraggableEl(),
              options.getContainerEl()
            ])
            if (retryDraggableEl && retryContainerEl) {
              this.#draggableEl = retryDraggableEl as HTMLElement
              this.#containerEl = retryContainerEl as HTMLElement
              this.#init()
            }
          }, 50)
          return
        }

        // TODO Add typeguard to check if HTMLElement
        this.#draggableEl = draggableEl as HTMLElement
        this.#containerEl = containerEl as HTMLElement
        this.#init()
      }
    )

    const storageValue = this.#localStorageKey
      ? localStorage.getItem(this.#localStorageKey)
        ? parseInt(localStorage.getItem(this.#localStorageKey)!, 10)
        : undefined
      : undefined
    // A stored height is the user's own choice and keeps winning; only a
    // derived default follows the window.
    this.#userChosen =
      storageValue !== undefined && Number.isFinite(storageValue)
    const initialPosition = this.#userChosen
      ? storageValue!
      : (resolveBound(this.#options.initialPosition) ?? 0)
    this.#setPosition(initialPosition, initialPosition)
  }

  /**
   * Own listener, not `window.onresize`: that is a single slot, so with five
   * controllers on the page only the last one constructed ever ran — which is
   * why nothing re-fitted on resize.
   *
   * Registered per CONNECT, not once in the constructor: Lit detaches and
   * reattaches a host without rebuilding its controllers, and a listener
   * removed on disconnect and never restored leaves that pane deaf to resizes
   * for the rest of the page's life. `addEventListener` with the same
   * reference is idempotent, so reconnecting twice cannot double-subscribe.
   */
  hostConnected(): void {
    window.addEventListener('resize', this.#onWindowResize)
  }

  /** Follow the window — the same re-resolution a changed input triggers. */
  #onWindowResize = () => {
    this.refreshBounds()
    this.#host.requestUpdate()
    void this.#adjustPosition()
  }

  async #getDraggableEl() {
    await this.#host.updateComplete
    return this.#host.shadowRoot!.querySelector(
      `button[data-draggable-id="${this.#id}"]`
    )
  }

  #setPosition(x: number, y: number) {
    const min = resolveBound(this.#options.minPosition) ?? 0
    const max = resolveBound(this.#options.maxPosition)
    if (this.#options.direction === Direction.horizontal) {
      let nx = Math.max(x, min)
      if (max !== undefined) {
        nx = Math.min(nx, max)
      }
      this.#x = nx
    } else {
      let ny = Math.max(y, min)
      if (max !== undefined) {
        ny = Math.min(ny, max)
      }
      this.#y = ny
    }
  }

  #getPosition() {
    return this.#options.direction === Direction.horizontal ? this.#x : this.#y
  }

  getPosition() {
    return `flex-basis: ${this.#getPosition()}px`
  }

  #init() {
    // stop previous tracker if element was re-created
    if (this.#pointerTracker) {
      this.#pointerTracker.stop()
      this.#pointerTracker = null
    }

    const onDrag = this.#onDrag
    const onDragStart = this.#onDragStart
    const onDragEnd = this.#onDragEnd
    const adjustPosition = this.#adjustPosition.bind(this)
    const updateState = (state: State) => (this.#state = state)
    const host = this.#host

    this.#pointerTracker = new PointerTracker(this.#draggableEl, {
      start(pointer: Pointer) {
        onDragStart(pointer)
        updateState('dragging')
        host.requestUpdate()
        return true
      },
      move(previousPointers: Pointer[], changedPointers: Pointer[]) {
        onDrag(previousPointers, changedPointers)
      },
      end(pointer: Pointer, ev: Event) {
        onDragEnd(pointer, ev as InputEvent)
        updateState('idle')
        host.requestUpdate()
        adjustPosition()
      }
    })

    this.#adjustPosition()
  }

  /**
   * Re-resolve this pane against its inputs as they are NOW, and report whether
   * it moved.
   *
   * A derived default is recomputed outright: its inputs are not all present
   * when a controller is constructed — a workbench builds its controllers
   * during field initialization, before the consumed metadata context has
   * delivered anything — so a default derived from a capture's shape starts
   * from a fallback.
   *
   * A position the USER chose is re-clamped rather than left alone, because the
   * bounds are derived too. A width chosen for one capture's shape can exceed
   * what the next one allows, and without this it kept an obsolete oversized
   * column, taking room from its neighbour until something resized the window.
   *
   * Call this when an INPUT changes, never on every render: the derivation must
   * not be fed a box that is still settling, which is how an earlier attempt at
   * this produced a 40px column.
   */
  refreshBounds(): boolean {
    const before = this.#getPosition()
    if (this.#userChosen) {
      this.#setPosition(this.#x, this.#y)
    } else {
      const derived = resolveBound(this.#options.initialPosition) ?? 0
      this.#setPosition(derived, derived)
    }
    return this.#getPosition() !== before
  }

  hostUpdated() {
    this.#maybeReinit()
  }

  hostDisconnected(): void {
    if (this.#pointerTracker) {
      this.#pointerTracker.stop()
    }
    window.removeEventListener('resize', this.#onWindowResize)
  }

  #handleWindowMove(pointer: Pointer) {
    if (!this.#draggableEl || !this.#containerEl) {
      return
    }

    const oldX = this.#x
    const oldY = this.#y

    // JavaScript’s floats can be weird, so we’re flooring these to integers.
    const cursorPositionX = Math.floor(pointer.pageX)
    const cursorPositionY = Math.floor(pointer.pageY)

    const hasCursorMoved =
      cursorPositionX !== this.#cursorPositionX ||
      cursorPositionY !== this.#cursorPositionY

    if (hasCursorMoved) {
      // The difference between the cursor’s previous position and its current position.
      const xDelta = cursorPositionX - this.#cursorPositionX
      const yDelta = cursorPositionY - this.#cursorPositionY

      const sign = this.#options.anchor === 'end' ? -1 : 1
      this.#setPosition(oldX + sign * xDelta, oldY + sign * yDelta)
      // From here on this pane's height is the user's, not the window's.
      this.#userChosen = true

      if (this.#localStorageKey) {
        localStorage.setItem(
          this.#localStorageKey,
          JSON.stringify(this.#getPosition())
        )
      }

      this.#cursorPositionX = cursorPositionX
      this.#cursorPositionY = cursorPositionY
      this.#host.requestUpdate()
    }
  }

  #onDragStart = (pointer: Pointer) => {
    this.#cursorPositionX = Math.floor(pointer.pageX)
    this.#cursorPositionY = Math.floor(pointer.pageY)

    return true
  }

  #onDrag = (_previousPointers: Pointer[], pointers: Pointer[]) => {
    const [pointer] = pointers
    window.dispatchEvent(
      new CustomEvent('window-drag', {
        bubbles: true,
        composed: true,
        detail: {
          pointer,
          containerEl: this.#containerEl,
          draggableEl: this.#draggableEl
        }
      })
    )
    this.#handleWindowMove(pointer)
  }

  #onDragEnd = (_pointer: Pointer, ev: InputEvent) => {
    const el = ev.target! as HTMLDivElement
    el.removeAttribute('data-state')
  }

  async #maybeReinit() {
    const draggableEl = await this.#getDraggableEl()
    if (!draggableEl) {
      return
    }
    // if slider was removed (collapsed) and re-added, re-init pointer tracker
    if (this.#draggableEl !== draggableEl) {
      this.#draggableEl = draggableEl as HTMLElement
      // The container often doesn't exist at construction (the sidebar renders
      // only after a connection), so it must be resolved here too — otherwise
      // the tracker attaches but #handleWindowMove bails on a null container
      // and the drag silently no-ops.
      if (!this.#containerEl) {
        const containerEl = await this.#options.getContainerEl()
        if (containerEl) {
          this.#containerEl = containerEl as HTMLElement
        }
      }
      this.#init()
    }
  }

  getSlider(className = '') {
    const fromEnd = this.#options.anchor === 'end'
    const anchor =
      this.#options.direction === Direction.horizontal
        ? fromEnd
          ? 'right'
          : 'left'
        : this.#options.direction === Direction.vertical
          ? fromEnd
            ? 'bottom'
            : 'top'
          : ''
    // The edge class must match the anchor. It used to be `left-0`/`top-0`
    // unconditionally, which an inline `left`/`top` simply overrides — but an
    // END-anchored handle sets the OPPOSITE property, so `left:0` from the
    // class and `right:Npx` inline both applied and, on a fixed-width absolute
    // box, `left` wins: the handle pinned itself to the container's start edge
    // instead of sitting on its own pane.
    className +=
      this.#options.direction === Direction.horizontal
        ? ` cursor-col-resize ${fromEnd ? 'right-0' : 'left-0'} h-full w-[10px]`
        : this.#options.direction === Direction.vertical
          ? ` cursor-row-resize ${fromEnd ? 'bottom-0' : 'top-0'} w-full h-[10px]`
          : ''

    return html`
      <button
        data-draggable-id=${this.#id}
        data-dragging=${this.#state}
        style=${styleMap({ [anchor]: `${this.#getPosition() - 5}px` })}
        class="absolute ${className}"
      ></button>
    `
  }

  async #adjustPosition() {
    const draggableEl = await this.#getDraggableEl()
    if (!draggableEl) {
      return
    }

    // allow matching when additional inline styles are present
    const slidingElem = (
      draggableEl.parentElement || this.#host.shadowRoot
    )?.querySelector(`*[style*="flex-basis: ${this.#getPosition()}px"]`)
    if (!slidingElem) {
      return
    }
    const rect = (slidingElem as HTMLElement).getBoundingClientRect()
    const direction =
      this.#options.direction === Direction.horizontal ? 'width' : 'height'
    const compareVal = rect[direction]
    if (this.#getPosition() !== compareVal) {
      this.#setPosition(rect.width, rect.height)
      this.#host.requestUpdate()
    }
  }
}
