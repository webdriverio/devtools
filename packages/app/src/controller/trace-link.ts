import type { ReactiveController, ReactiveControllerHost } from 'lit'
import {
  isTraceLinkValue,
  parseTraceLink,
  type TraceLink
} from '@wdio/devtools-shared'

import {
  DOCK_TAB_CHANGE_EVENT,
  DOCK_TABS_READY_EVENT,
  OPEN_DOCK_TAB_EVENT
} from './constants.js'
import { PLAYER_SEEK_ACTION_EVENT } from '../components/browser/trace-timeline-constants.js'
import {
  clearTraceAddress,
  currentTraceLink,
  hasTraceParam,
  updateTraceLink
} from '../utils/trace-link.js'

export interface TraceLinkOptions {
  isPlayer: () => boolean
  /** Several traces are open as a run; the hash names no run entry, so it carries no action then. */
  isRun: () => boolean
}

const seekAction = (callId: string): boolean =>
  window.dispatchEvent(
    new CustomEvent<string>(PLAYER_SEEK_ACTION_EVENT, { detail: callId })
  )

const openLinkedTab = (label: string): boolean =>
  window.dispatchEvent(
    new CustomEvent(OPEN_DOCK_TAB_EVENT, { detail: { label, linked: true } })
  )

/** Owns the address's `#action=…&tab=…`: applies it to the trace the address came with, and keeps it naming what is shown. */
export class TraceLinkController implements ReactiveController {
  readonly #options: TraceLinkOptions
  /** The page address's link, not yet applied; applied once, to the first trace shown. */
  #pending: TraceLink
  #shownTrace = false

  constructor(host: ReactiveControllerHost, options: TraceLinkOptions) {
    this.#options = options
    this.#pending = currentTraceLink()
    host.addController(this)
  }

  hostConnected() {
    window.addEventListener('show-command', this.#onShowCommand)
    window.addEventListener(DOCK_TABS_READY_EVENT, this.#onDockReady)
    window.addEventListener(DOCK_TAB_CHANGE_EVENT, this.#onDockTabChange)
    window.addEventListener('hashchange', this.#onHashChange)
  }

  hostDisconnected() {
    window.removeEventListener('show-command', this.#onShowCommand)
    window.removeEventListener(DOCK_TABS_READY_EVENT, this.#onDockReady)
    window.removeEventListener(DOCK_TAB_CHANGE_EVENT, this.#onDockTabChange)
    window.removeEventListener('hashchange', this.#onHashChange)
  }

  /** The viewer opened a trace by hand: once the address names another trace, its link and `?trace=` no longer apply. */
  forget() {
    if (!this.#shownTrace && !hasTraceParam()) {
      return
    }
    this.#pending = {}
    clearTraceAddress()
  }

  // A live command has no callId, so the live dashboard's address is never touched.
  #onShowCommand = (event: CustomEvent<CommandEventProps>): void => {
    if (!this.#options.isPlayer()) {
      return
    }
    this.#shownTrace = true
    if (this.#options.isRun()) {
      this.#pending.action = undefined
      if (currentTraceLink().action) {
        updateTraceLink({ action: undefined })
      }
      return
    }
    const pending = this.#pending.action
    if (pending) {
      this.#pending.action = undefined
      // After this event has reached every listener, or they would see this action after the linked one.
      queueMicrotask(() => seekAction(pending))
      return
    }
    const action = event.detail?.command?.callId
    if (action && isTraceLinkValue('action', action)) {
      updateTraceLink({ action })
    }
  }

  #onDockReady = (): void => {
    const { tab } = this.#pending
    this.#pending.tab = undefined
    if (tab && this.#options.isPlayer()) {
      openLinkedTab(tab)
    }
  }

  #onDockTabChange = (event: CustomEvent<string>): void => {
    const tab = event.detail.toLowerCase()
    if (this.#options.isPlayer() && isTraceLinkValue('tab', tab)) {
      updateTraceLink({ tab })
    }
  }

  // Only a hash the viewer typed or followed fires this; `replaceState` never does.
  #onHashChange = (event: HashChangeEvent): void => {
    if (!this.#options.isPlayer()) {
      return
    }
    const { action, tab } = currentTraceLink()
    const before = event.oldURL
      ? parseTraceLink(new URL(event.oldURL).hash)
      : {}
    if (action && action !== before.action && !this.#options.isRun()) {
      seekAction(action)
    }
    if (tab && tab !== before.tab) {
      openLinkedTab(tab)
    }
  }
}
