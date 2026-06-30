import { Element } from '@core/element'
import { html, nothing, type TemplateResult } from 'lit'
import { customElement, state, query } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { CommandLog, TracePlayerFrame } from '@wdio/devtools-shared'

import {
  commandContext,
  framesContext,
  networkRequestContext
} from '../../controller/context.js'
import { commandCategory } from '../workbench/actionItems/category.js'
import { activeTimestampAt } from '../workbench/active-entry.js'
import { networkStyles } from '../workbench/network/styles.js'
import { renderNetworkRequestDetail } from '../workbench/network/request-detail.js'
import { KBD } from '../../controller/keyboard.js'
import {
  CATEGORY_BG,
  GUTTER,
  INSET,
  SPEEDS
} from './trace-timeline-constants.js'
import { formatTimecode, imageMime } from './trace-timeline-utils.js'
import { timelineStyles } from './trace-timeline-styles.js'

import '~icons/mdi/play.js'
import '~icons/mdi/pause.js'
import '~icons/mdi/skip-previous.js'
import '~icons/mdi/skip-next.js'
import '~icons/mdi/restart.js'

const COMPONENT = 'wdio-devtools-trace-timeline'

/**
 * Trace-player timeline (replaces the workbench dock in `pnpm show-trace`
 * mode). Owns the playback clock, the screenshot filmstrip, the per-track
 * timeline (actions / network / console), and the playhead. Advancing the
 * clock dispatches `show-command` so the reused browser pane swaps screenshots.
 */
@customElement(COMPONENT)
export class TraceTimeline extends Element {
  @consume({ context: commandContext, subscribe: true })
  @state()
  commands: CommandLog[] = []

  @consume({ context: framesContext, subscribe: true })
  @state()
  frames: TracePlayerFrame[] = []

  @consume({ context: networkRequestContext, subscribe: true })
  @state()
  networkRequests: NetworkRequest[] = []

  /** Playback position in ms relative to the recording start. */
  @state() currentMs = 0
  @state() playing = false
  @state() speed = 1

  #rafId?: number
  #rafLast = 0
  #activeTimestamp?: number
  #started = false

  @query('[data-lanes]') lanesEl?: HTMLElement

  #dragging = false

  /** Network request whose detail drawer is open, or undefined. */
  @state() selectedRequest?: NetworkRequest

  static styles = [...Element.styles, networkStyles, timelineStyles]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(KBD.togglePlay, this.#onKbdTogglePlay)
    window.addEventListener(KBD.step, this.#onKbdStep)
    window.addEventListener(KBD.jump, this.#onKbdJump)
    window.addEventListener(KBD.speed, this.#onKbdSpeed)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#stopRaf()
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
    window.removeEventListener(KBD.togglePlay, this.#onKbdTogglePlay)
    window.removeEventListener(KBD.step, this.#onKbdStep)
    window.removeEventListener(KBD.jump, this.#onKbdJump)
    window.removeEventListener(KBD.speed, this.#onKbdSpeed)
  }

  #onKbdTogglePlay = (): void => this.#togglePlay()
  #onKbdStep = (event: Event): void =>
    this.#step((event as CustomEvent<{ dir: -1 | 1 }>).detail.dir)
  #onKbdJump = (event: Event): void =>
    this.#seekToMs(
      (event as CustomEvent<{ to: 'start' | 'end' }>).detail.to === 'end'
        ? this.#duration
        : 0
    )
  #onKbdSpeed = (event: Event): void => {
    const delta = (event as CustomEvent<{ delta: -1 | 1 }>).detail.delta
    const i = SPEEDS.indexOf(this.speed)
    const next = Math.min(
      SPEEDS.length - 1,
      Math.max(0, (i < 0 ? 1 : i) + delta)
    )
    this.speed = SPEEDS[next]
  }

  // ─── window / geometry ────────────────────────────────────────────────────

  get #start(): number {
    const first = this.#sortedCommands[0]
    const frameStart = this.frames[0]?.timestamp ?? Infinity
    const cmdStart = first ? (first.startTime ?? first.timestamp) : Infinity
    const min = Math.min(frameStart, cmdStart)
    return Number.isFinite(min) ? min : 0
  }

  get #end(): number {
    const lastFrame = this.frames[this.frames.length - 1]?.timestamp ?? 0
    const lastCmd = this.#sortedCommands[this.#sortedCommands.length - 1]
    const cmdEnd = lastCmd?.timestamp ?? 0
    return Math.max(lastFrame, cmdEnd)
  }

  get #duration(): number {
    return Math.max(1, this.#end - this.#start)
  }

  get #sortedCommands(): CommandLog[] {
    return [...this.commands].sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    )
  }

  #fraction(timestamp: number): number {
    return Math.min(1, Math.max(0, (timestamp - this.#start) / this.#duration))
  }

  // ─── playback ─────────────────────────────────────────────────────────────

  protected firstUpdated(): void {
    // Defer one frame so the browser pane (which attaches its `show-command`
    // listener after `await updateComplete`) is ready to receive the first frame.
    requestAnimationFrame(() => this.#syncActiveCommand())
  }

  protected updated(): void {
    // Commands may arrive after mount; emit the first frame once they do.
    if (!this.#started && this.commands.length) {
      this.#syncActiveCommand()
    }
  }

  #stopRaf(): void {
    if (this.#rafId !== undefined) {
      cancelAnimationFrame(this.#rafId)
      this.#rafId = undefined
    }
  }

  #togglePlay(): void {
    if (this.playing) {
      this.playing = false
      this.#stopRaf()
      return
    }
    if (this.currentMs >= this.#duration) {
      this.currentMs = 0
    }
    this.playing = true
    this.#rafLast = performance.now()
    this.#rafId = requestAnimationFrame(this.#tick)
  }

  #tick = (now: number): void => {
    const delta = (now - this.#rafLast) * this.speed
    this.#rafLast = now
    const next = this.currentMs + delta
    if (next >= this.#duration) {
      this.currentMs = this.#duration
      this.playing = false
      this.#stopRaf()
      this.#syncActiveCommand()
      return
    }
    this.currentMs = next
    this.#syncActiveCommand()
    this.#rafId = requestAnimationFrame(this.#tick)
  }

  #seekToMs(ms: number): void {
    this.currentMs = Math.min(this.#duration, Math.max(0, ms))
    this.#syncActiveCommand()
  }

  #seekToTimestamp(timestamp: number): void {
    this.#seekToMs(timestamp - this.#start)
  }

  #step(direction: -1 | 1): void {
    const timestamps = this.#sortedCommands.map((c) => c.timestamp ?? 0)
    const clock = this.#start + this.currentMs
    if (direction === 1) {
      const next = timestamps.find((ts) => ts > clock + 1)
      if (next !== undefined) {
        this.#seekToTimestamp(next)
      }
      return
    }
    const prev = [...timestamps].reverse().find((ts) => ts < clock - 1)
    this.#seekToTimestamp(prev ?? this.#start)
  }

  #restart(): void {
    this.playing = false
    this.#stopRaf()
    this.#seekToMs(0)
  }

  // Dispatch `show-command` for the action active at the current clock so the
  // (reused) browser pane updates its screenshot.
  #syncActiveCommand(): void {
    const sorted = this.#sortedCommands
    if (!sorted.length) {
      return
    }
    const clock = this.#start + this.currentMs
    const timestamps = sorted.map((c) => c.timestamp ?? 0)
    const activeTs = activeTimestampAt(timestamps, clock) ?? timestamps[0]
    if (this.#started && activeTs === this.#activeTimestamp) {
      return
    }
    this.#started = true
    this.#activeTimestamp = activeTs
    const command = sorted.find((c) => (c.timestamp ?? 0) === activeTs)
    if (command) {
      window.dispatchEvent(
        new CustomEvent('show-command', { detail: { command } })
      )
    }
  }

  #onSpeedChange(event: Event): void {
    this.speed = Number((event.target as HTMLSelectElement).value)
  }

  // ─── scrubbing (free-flow playhead drag) ───────────────────────────────────

  #fractionFromClientX(clientX: number): number {
    const rect = this.lanesEl?.getBoundingClientRect()
    if (!rect) {
      return 0
    }
    const laneStart = rect.left + GUTTER
    const laneWidth = rect.width - GUTTER - INSET
    if (laneWidth <= 0) {
      return 0
    }
    return Math.min(1, Math.max(0, (clientX - laneStart) / laneWidth))
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    this.playing = false
    this.#stopRaf()
    this.#dragging = true
    window.addEventListener('pointermove', this.#onPointerMove)
    window.addEventListener('pointerup', this.#onPointerUp)
    this.#seekToMs(this.#fractionFromClientX(event.clientX) * this.#duration)
  }

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging) {
      return
    }
    this.#seekToMs(this.#fractionFromClientX(event.clientX) * this.#duration)
  }

  #onPointerUp = (): void => {
    this.#dragging = false
    window.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('pointerup', this.#onPointerUp)
  }

  // ─── render ───────────────────────────────────────────────────────────────

  #ctrlButton(
    title: string,
    icon: TemplateResult,
    onClick: () => void,
    extra = ''
  ): TemplateResult {
    return html`<button
      class="p-1 hover:bg-toolbarHoverBackground rounded ${extra}"
      title="${title}"
      @click="${onClick}"
    >
      ${icon}
    </button>`
  }

  #renderControls(): TemplateResult {
    return html`
      <div
        class="flex items-center gap-1 px-2 h-9 border-b border-panelBorder flex-none text-[12px]"
      >
        ${this.#ctrlButton(
          'Restart',
          html`<icon-mdi-restart></icon-mdi-restart>`,
          () => this.#restart()
        )}
        ${this.#ctrlButton(
          'Previous action',
          html`<icon-mdi-skip-previous></icon-mdi-skip-previous>`,
          () => this.#step(-1)
        )}
        ${this.#ctrlButton(
          this.playing ? 'Pause' : 'Play',
          this.playing
            ? html`<icon-mdi-pause></icon-mdi-pause>`
            : html`<icon-mdi-play></icon-mdi-play>`,
          () => this.#togglePlay(),
          'text-chartsBlue'
        )}
        ${this.#ctrlButton(
          'Next action',
          html`<icon-mdi-skip-next></icon-mdi-skip-next>`,
          () => this.#step(1)
        )}
        <code class="ml-2 tabular-nums text-chartsYellow"
          >${formatTimecode(this.currentMs)}</code
        >
        <span class="opacity-60">/</span>
        <code class="tabular-nums opacity-80"
          >${formatTimecode(this.#duration)}</code
        >
        <select
          class="ml-auto bg-sideBarBackground border border-panelBorder rounded px-1 py-0.5"
          title="Playback speed"
          @change="${this.#onSpeedChange}"
        >
          ${SPEEDS.map(
            (speed) =>
              html`<option value="${speed}" ?selected="${speed === this.speed}">
                ${speed}×
              </option>`
          )}
        </select>
      </div>
    `
  }

  /** Timestamp of the frame nearest the playhead — drives filmstrip highlight. */
  get #activeFrameTimestamp(): number | undefined {
    const clock = this.#start + this.currentMs
    let best: number | undefined
    let bestDelta = Infinity
    for (const frame of this.frames) {
      const delta = Math.abs(frame.timestamp - clock)
      if (delta < bestDelta) {
        bestDelta = delta
        best = frame.timestamp
      }
    }
    return best
  }

  // CSS left for a marker inside a track body (which starts after the gutter),
  // leaving INSET of right margin so end-of-timeline markers don't hug the edge.
  #laneLeft(fraction: number): string {
    return `calc(${fraction} * (100% - ${INSET}px))`
  }

  #renderFilmstrip(): TemplateResult {
    if (!this.frames.length) {
      return html`<div
        class="flex-none h-16 border-b border-panelBorder flex items-center justify-center text-[11px] opacity-50"
      >
        No frames captured
      </div>`
    }
    const activeFrame = this.#activeFrameTimestamp
    return html`
      <div
        class="flex-none h-16 border-b border-panelBorder flex items-stretch"
      >
        <div class="flex-none w-20 border-r border-panelBorder"></div>
        <div
          class="no-scrollbar flex-1 min-w-0 flex items-stretch gap-1 px-1 py-1 overflow-x-auto"
        >
          ${this.frames.map(
            (frame) =>
              html`<button
                class="h-full aspect-video flex-none border rounded overflow-hidden hover:border-chartsBlue ${frame.timestamp ===
                activeFrame
                  ? 'border-chartsBlue ring-1 ring-chartsBlue'
                  : 'border-panelBorder'}"
                title="${formatTimecode(frame.timestamp - this.#start)}"
                @click="${() => this.#seekToTimestamp(frame.timestamp)}"
              >
                <img
                  class="h-full w-full object-cover"
                  src="data:${imageMime(
                    frame.screenshot
                  )};base64,${frame.screenshot}"
                />
              </button>`
          )}
        </div>
      </div>
    `
  }

  #renderTrack(
    label: string,
    body: TemplateResult | typeof nothing
  ): TemplateResult {
    return html`
      <div class="flex items-stretch h-7 border-b border-panelBorder/50">
        <div
          class="flex-none w-20 px-2 flex items-center text-[11px] opacity-60 border-r border-panelBorder"
        >
          ${label}
        </div>
        <div class="relative flex-1 overflow-hidden">${body}</div>
      </div>
    `
  }

  #renderActionsTrack(): TemplateResult {
    const body = html`${this.#sortedCommands.map((command) => {
      const ts = command.timestamp ?? 0
      const fraction = this.#fraction(ts)
      const active = ts === this.#activeTimestamp
      const color = CATEGORY_BG[commandCategory(command.command)]
      // Track chips stay compact with the short command name; the full
      // Playwright label is the hover tooltip (and the left Actions list).
      return html`<button
        class="absolute top-1 bottom-1 ${color} rounded-sm px-1 text-[10px] leading-none text-black/80 whitespace-nowrap max-w-[140px] overflow-hidden text-ellipsis ${active
          ? 'ring-1 ring-white'
          : ''}"
        style="left:${this.#laneLeft(
          fraction
        )}; transform:translateX(-${fraction * 100}%);"
        title="${command.title ?? command.command}"
        @click="${(event: MouseEvent) => {
          event.stopPropagation()
          this.#seekToTimestamp(ts)
        }}"
      >
        ${command.command}
      </button>`
    })}`
    return this.#renderTrack('Actions', body)
  }

  #renderNetworkTrack(): TemplateResult {
    if (!this.networkRequests.length) {
      return this.#renderTrack('Network', nothing)
    }
    const body = html`${this.networkRequests.map((request) => {
      const leftFr = this.#fraction(request.startTime)
      const rawFr = Math.max(0.004, (request.time ?? 0) / this.#duration)
      const widthFr = Math.min(rawFr, 1 - leftFr)
      const selected = this.selectedRequest?.id === request.id
      // stopPropagation so a click selects the request rather than scrubbing the
      // playhead (the lanes container owns the pointerdown drag handler).
      return html`<div
        class="absolute top-2 bottom-2 rounded-sm cursor-pointer ${selected
          ? 'bg-chartsBlue ring-1 ring-white'
          : 'bg-chartsBlue/60 hover:bg-chartsBlue'}"
        style="left:${this.#laneLeft(leftFr)}; width:${this.#laneLeft(
          widthFr
        )}; min-width:3px;"
        title="${request.method} ${request.url}"
        @pointerdown="${(e: PointerEvent) => e.stopPropagation()}"
        @click="${(e: MouseEvent) => {
          e.stopPropagation()
          this.selectedRequest = selected ? undefined : request
        }}"
      ></div>`
    })}`
    return this.#renderTrack('Network', body)
  }

  #renderNetworkDrawer(): TemplateResult | typeof nothing {
    const req = this.selectedRequest
    if (!req) {
      return nothing
    }
    return html`
      <div class="net-drawer">
        <div class="net-drawer-head">
          <span class="url" title="${req.url}">${req.method} ${req.url}</span>
          <span
            class="close"
            title="Close"
            @click="${() => (this.selectedRequest = undefined)}"
            >✕</span
          >
        </div>
        <div class="net-drawer-body">${renderNetworkRequestDetail(req)}</div>
      </div>
    `
  }

  #renderPlayhead(): TemplateResult {
    const fraction = Math.min(1, Math.max(0, this.currentMs / this.#duration))
    // Anchored at the gutter and inset on the right so it tracks the same lane
    // coordinates as the action/network markers.
    return html`<div
      class="absolute top-0 bottom-0 w-0.5 bg-chartsRed z-20 pointer-events-none"
      style="left:calc(${GUTTER}px + ${fraction} * (100% - ${GUTTER}px - ${INSET}px));"
    ></div>`
  }

  render() {
    return html`
      ${this.#renderControls()} ${this.#renderFilmstrip()}
      <div
        data-lanes
        class="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden cursor-ew-resize select-none"
        @pointerdown="${this.#onPointerDown}"
      >
        ${this.#renderActionsTrack()} ${this.#renderNetworkTrack()}
        ${this.#renderTrack('Console', nothing)} ${this.#renderPlayhead()}
      </div>
      ${this.#renderNetworkDrawer()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: TraceTimeline
  }
}
