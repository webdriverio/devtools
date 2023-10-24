import { ReactiveController, ReactiveControllerHost } from 'lit'
import PointerTracker, {
  Pointer,
  InputEvent as PtInputEvent,
} from 'pointer-tracker'
import { StyleInfo } from 'lit/directives/style-map.js'

interface InitialPosition {
  x?: number
  y?: number
}

type DragControllerHost = HTMLElement & ReactiveControllerHost

type AsyncGetElFn = () => Element | Promise<Element | null>

interface DragControllerOptions {
  initialPosition: InitialPosition
  getContainerEl: AsyncGetElFn
  getDraggableEl: AsyncGetElFn
  getIsDraggable?: () => boolean
  horizontal?: boolean
  vertical?: boolean
}

type State = 'dragging' | 'idle'

const defaultOptions: Required<DragControllerOptions> = {
  initialPosition: {},
  getContainerEl: () => Promise.resolve(null),
  getDraggableEl: () => Promise.resolve(null),
  getIsDraggable: () => true,
  horizontal: true,
  vertical: true
}

export class DragController implements ReactiveController {
  #host: DragControllerHost
  #options: Required<DragControllerOptions>

  x
  y

  cursorPositionX = 0
  cursorPositionY = 0

  containerEl: HTMLElement = null!
  getIsDraggable: () => boolean
  draggableEl: HTMLElement = null!

  state: State = 'idle'

  pointerTracker: PointerTracker | null = null

  styles: StyleInfo = {
    position: 'absolute',
    touchAction: 'none',
    top: '0px',
    left: '0px',
  }

  constructor(
    host: DragControllerHost,
    options: DragControllerOptions = defaultOptions
  ) {
    this.#host = host
    this.#host.addController(this)
    this.#options = Object.assign({}, defaultOptions, options)

    this.getIsDraggable = options.getIsDraggable ?? defaultOptions.getIsDraggable

    Promise.all([
      options.getDraggableEl(),
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

      // TODO Add typeguard to check if HTMLElement
      this.draggableEl = draggableEl as HTMLElement
      this.containerEl = containerEl as HTMLElement
      this.init()
    })

    const { initialPosition } = options
    const { x = 0, y = 0 } = initialPosition

    this.x = x
    this.y = y
  }

  init() {
    const onDrag = this.#onDrag
    const onDragStart = this.#onDragStart
    const onDragEnd = this.#onDragEnd
    const host = this.#host

    const updateState = (state: State) => (this.state = state)

    this.pointerTracker = new PointerTracker(this.draggableEl, {
      start(pointer) {
        onDragStart(pointer)
        updateState('dragging')
        host.requestUpdate()
        return true
      },
      move(previousPointers, changedPointers) {
        onDrag(previousPointers, changedPointers)
      },
      end(pointer, ev) {
        onDragEnd(pointer, ev)
        updateState('idle')
        host.requestUpdate()
      },
    })
  }

  hostDisconnected(): void {
    if (this.pointerTracker) {
      this.pointerTracker.stop()
    }
  }

  handleWindowMove(pointer: Pointer) {
    console.log(1, this.draggableEl, this.containerEl)

    if (!this.draggableEl || !this.containerEl) {
      return
    }

    const isDraggable = this.getIsDraggable()
    if (!isDraggable) {
      return
    }

    const oldX = this.x
    const oldY = this.y

    // JavaScript’s floats can be weird, so we’re flooring these to integers.
    const cursorPositionX = Math.floor(pointer.pageX)
    const cursorPositionY = Math.floor(pointer.pageY)

    const hasCursorMoved =
      cursorPositionX !== this.cursorPositionX ||
      cursorPositionY !== this.cursorPositionY

    if (hasCursorMoved) {
      // The difference between the cursor’s previous position and its current position.
      const xDelta = cursorPositionX - this.cursorPositionX
      const yDelta = cursorPositionY - this.cursorPositionY

      if (this.#options.horizontal) {
        this.x = oldX + xDelta
        console.log(this.x, oldX, xDelta);

      }
      if (this.#options.vertical) {
        this.y = oldY + yDelta
      }

      this.cursorPositionX = cursorPositionX
      this.cursorPositionY = cursorPositionY
      this.#host.requestUpdate()
    }
  }

  #onDragStart = (pointer: Pointer) => {
    this.cursorPositionX = Math.floor(pointer.pageX)
    this.cursorPositionY = Math.floor(pointer.pageY)

    return true
  }

  #onDrag = (_previousPointers: Pointer[], pointers: Pointer[]) => {
    const [pointer] = pointers
    this.#host.dispatchEvent(new CustomEvent('window-drag', {
      bubbles: true,
      composed: true,
      detail: {
        pointer,
        containerEl: this.containerEl,
        draggableEl: this.draggableEl
      }
    }))
    this.handleWindowMove(pointer)
  }

  #onDragEnd = (_pointer: Pointer, ev: PtInputEvent) => {
    const el = ev.target! as HTMLDivElement
    el.removeAttribute('data-state')
  }
}
