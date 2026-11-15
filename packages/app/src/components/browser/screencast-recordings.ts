import {
  SCREENCAST_READY_EVENT,
  SCREENCAST_RESET_EVENT
} from '../../controller/constants.js'

export interface ScreencastReadyDetail {
  sessionId: string
  startTime?: number
  duration?: number
}

export interface ScreencastRecording extends ScreencastReadyDetail {
  url: string
}

export type ViewportMode = 'snapshot' | 'video'

declare global {
  interface WindowEventMap {
    [SCREENCAST_READY_EVENT]: CustomEvent<ScreencastReadyDetail>
    [SCREENCAST_RESET_EVENT]: CustomEvent<void>
  }
}

export function announceScreencastReady(detail: ScreencastReadyDetail) {
  window.dispatchEvent(new CustomEvent(SCREENCAST_READY_EVENT, { detail }))
}

export function announceScreencastReset() {
  window.dispatchEvent(new CustomEvent(SCREENCAST_RESET_EVENT))
}

export class ScreencastRecordings {
  #items: ScreencastRecording[] = []
  #activeIndex = 0
  #viewMode: ViewportMode = 'snapshot'

  get items(): readonly ScreencastRecording[] {
    return this.#items
  }

  get activeIndex(): number {
    return this.#activeIndex
  }

  get viewMode(): ViewportMode {
    return this.#viewMode
  }

  get active(): ScreencastRecording | undefined {
    return this.#items[this.#activeIndex]
  }

  get activeUrl(): string | null {
    return this.active?.url ?? null
  }

  add(detail: ScreencastReadyDetail) {
    this.#items.push({
      sessionId: detail.sessionId,
      url: `/api/video/${detail.sessionId}`,
      startTime: detail.startTime,
      duration: detail.duration
    })
    this.#activeIndex = this.#items.length - 1
    this.#viewMode = 'video'
  }

  select(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.#items.length) {
      return false
    }
    if (this.#activeIndex === index && this.#viewMode === 'video') {
      return false
    }
    this.#activeIndex = index
    this.#viewMode = 'video'
    return true
  }

  setViewMode(mode: ViewportMode): boolean {
    if (mode === this.#viewMode) {
      return false
    }
    this.#viewMode = mode
    return true
  }

  reset(): boolean {
    const changed =
      this.#items.length > 0 ||
      this.#activeIndex !== 0 ||
      this.#viewMode !== 'snapshot'
    this.#items = []
    this.#activeIndex = 0
    this.#viewMode = 'snapshot'
    return changed
  }
}
