import type { ReactiveController, ReactiveControllerHost } from 'lit'

/** Window CustomEvents emitted by the keyboard controller. Player components
 *  (the timeline) and the sidebar filter listen for the ones they handle, so
 *  the same shortcuts work in both the trace player and the live dashboard. */
export const KBD = {
  togglePlay: 'kbd:toggle-play',
  step: 'kbd:step', // detail: { dir: -1 | 1 }
  jump: 'kbd:jump', // detail: { to: 'start' | 'end' }
  speed: 'kbd:speed', // detail: { delta: -1 | 1 }
  focusFilter: 'kbd:focus-filter'
} as const

export interface KeyboardOptions {
  /** Whether the trace player is active — gates the playback keys. */
  isPlayer: () => boolean
  /** Toggle the shortcuts help overlay. */
  toggleHelp: () => void
}

function isTyping(event: KeyboardEvent): boolean {
  const el = (event.composedPath()[0] ?? event.target) as HTMLElement | null
  if (!el || !el.tagName) {
    return false
  }
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

export function emit(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** Global keyboard shortcuts, attached at the app root. Maps keys to semantic
 *  window events rather than reaching into components, so player and dashboard
 *  reuse the same wiring. */
export class KeyboardController implements ReactiveController {
  #opts: KeyboardOptions

  constructor(host: ReactiveControllerHost, opts: KeyboardOptions) {
    host.addController(this)
    this.#opts = opts
  }

  hostConnected(): void {
    window.addEventListener('keydown', this.#onKey)
  }

  hostDisconnected(): void {
    window.removeEventListener('keydown', this.#onKey)
  }

  // Navigation keys → step/jump, in BOTH modes. The player steps the timeline;
  // the dashboard walks the command list (both via the same events).
  #navKeys: Record<string, () => void> = {
    ArrowLeft: () => emit(KBD.step, { dir: -1 }),
    ArrowRight: () => emit(KBD.step, { dir: 1 }),
    Home: () => emit(KBD.jump, { to: 'start' }),
    End: () => emit(KBD.jump, { to: 'end' })
  }

  // Playback keys → only meaningful in the player.
  #playerKeys: Record<string, () => void> = {
    ' ': () => emit(KBD.togglePlay),
    ',': () => emit(KBD.speed, { delta: -1 }),
    '.': () => emit(KBD.speed, { delta: 1 })
  }

  #onKey = (event: KeyboardEvent): void => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.defaultPrevented
    ) {
      return
    }
    // Help toggles from anywhere; the rest are ignored while typing in a field.
    if (event.key === '?') {
      event.preventDefault()
      this.#opts.toggleHelp()
      return
    }
    if (isTyping(event)) {
      return
    }
    if (event.key === '/') {
      event.preventDefault()
      emit(KBD.focusFilter)
      return
    }
    const handler =
      this.#navKeys[event.key] ??
      (this.#opts.isPlayer() ? this.#playerKeys[event.key] : undefined)
    if (handler) {
      event.preventDefault()
      handler()
    }
  }
}
