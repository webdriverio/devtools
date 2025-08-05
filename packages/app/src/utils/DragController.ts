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

interface DragControllerOptions {
  initialPosition: number
  direction: Direction
  localStorageKey?: string
  minPosition?: number
  getContainerEl: AsyncGetElFn
}

type State = 'dragging' | 'idle'

const defaultOptions = {
  getContainerEl: () => Promise.resolve(null),
  getDraggableEl: () => Promise.resolve(null)
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

  constructor(
    host: DragControllerHost,
    options: DragControllerOptions
  ) {
    this.#host = host
    this.#host.addController(this)
    this.#options = Object.assign({}, defaultOptions, options)
    this.#localStorageKey = options.localStorageKey

    Promise.all([
      this.#getDraggableEl(),
      options.getContainerEl()
    ]).then(([draggableEl, containerEl]) => {
      if (!draggableEl) {
        console.warn('getDraggableEl() did not return an element HTMLElement')
      }
      if (!containerEl) {
        console.warn('getContainerEl() did not return an element HTMLElement')
      }

      if (!draggableEl || !containerEl) {
        return
      }

      window.onresize = () => this.#adjustPosition()

      // TODO Add typeguard to check if HTMLElement
      this.#draggableEl = draggableEl as HTMLElement
      this.#containerEl = containerEl as HTMLElement
      this.#init()
    })

    const storageValue = this.#localStorageKey
      ? localStorage.getItem(this.#localStorageKey)
        ? parseInt(localStorage.getItem(this.#localStorageKey)!, 10)
        : undefined
      : undefined
    const initialPosition = storageValue || this.#options.initialPosition
    this.#setPosition(initialPosition, initialPosition)
  }

  async #getDraggableEl () {
    await this.#host.updateComplete
    return this.#host.shadowRoot!.querySelector(`button[data-draggable-id="${this.#id}"]`)
  }

  #setPosition(x: number, y: number) {
    if (this.#options.direction === Direction.horizontal) {
      this.#x = Math.max(x, this.#options.minPosition || 0)
    } else if (this.#options.direction === Direction.vertical) {
      this.#y = Math.max(y, this.#options.minPosition || 0)
    }
  }

  #getPosition() {
    return this.#options.direction === Direction.horizontal
      ? this.#x
      : this.#y
  }

  getPosition () {
    return `flex-basis: ${this.#getPosition()}px`
  }

  #init() {
    const onDrag = this.#onDrag
    const onDragStart = this.#onDragStart
    const onDragEnd = this.#onDragEnd
    const adjustPosition = this.#adjustPosition.bind(this)
    const updateState = (state: State) => (this.#state = state)
    const host = this.#host

    this.#pointerTracker = new PointerTracker(this.#draggableEl, {
      start(pointer: any) {
        onDragStart(pointer)
        updateState('dragging')
        host.requestUpdate()
        return true
      },
      move(previousPointers: any, changedPointers: any) {
        onDrag(previousPointers, changedPointers)
      },
      end(pointer: any, ev: Event) {
        onDragEnd(pointer, ev)
        updateState('idle')
        host.requestUpdate()
        adjustPosition()
      },
    })

    this.#adjustPosition()
  }

  hostDisconnected(): void {
    if (this.#pointerTracker) {
      this.#pointerTracker.stop()
    }
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

      this.#setPosition(oldX + xDelta, oldY + yDelta)

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
    window.dispatchEvent(new CustomEvent('window-drag', {
      bubbles: true,
      composed: true,
      detail: {
        pointer,
        containerEl: this.#containerEl,
        draggableEl: this.#draggableEl
      }
    }))
    this.#handleWindowMove(pointer)
  }

  #onDragEnd = (_pointer: Pointer, ev: InputEvent) => {
    const el = ev.target! as HTMLDivElement
    el.removeAttribute('data-state')
  }

  getSlider(className = '') {
    const anchor = this.#options.direction === Direction.horizontal
      ? 'left'
      : this.#options.direction === Direction.vertical
        ? 'top'
        : ''
    className += this.#options.direction === Direction.horizontal
      ? ' cursor-col-resize left-0 h-full w-[10px]'
      : this.#options.direction === Direction.vertical
        ? ' cursor-row-resize top-0 w-full h-[10px]'
        : ''

    return html`
      <button
        data-draggable-id=${this.#id}
        data-dragging=${this.#state}
        style=${styleMap({ [anchor]: `${this.#getPosition() - 3}px` })}
        class="absolute ${className}"></button>
    `
  }

  async #adjustPosition() {
    const draggableEl = await this.#getDraggableEl()
    if (!draggableEl) {
      return
    }

    const slidingElem = (draggableEl.parentElement || this.#host.shadowRoot)?.querySelector(`*[style="${this.getPosition()}"]`)
    if (!slidingElem) {
      return console.log(`Could not find element to adjust position with style "${this.getPosition()}"`)
    }
    const rect = slidingElem.getBoundingClientRect()
    const direction = this.#options.direction === Direction.horizontal
      ? 'width'
      : 'height'
    const compareVal = rect[direction]
    if (this.#getPosition() !== compareVal) {
      this.#setPosition(rect.width, rect.height)
      this.#host.requestUpdate()
    }
  }
}
