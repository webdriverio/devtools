import { Element } from '@core/element'
import { html, type TemplateResult } from 'lit'
import { customElement, state, query } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { CommandLog, TracePlayerFrame } from '@wdio/devtools-shared'

import { commandContext, framesContext } from '../../controller/context.js'
import { activeSpanAt } from '../workbench/active-entry.js'
import { KBD } from '../../controller/keyboard.js'
import {
  PLAYER_RESTART_EVENT,
  PLAYER_SPEED_EVENT,
  PLAYER_STATE_EVENT,
  SPEEDS,
  type PlayerState
} from './trace-timeline-constants.js'
import {
  formatTickLabel,
  formatTimecode,
  imageMime,
  tickStep
} from './trace-timeline-utils.js'
import { timelineStyles } from './trace-timeline-styles.js'

const COMPONENT = 'wdio-devtools-trace-timeline'

/** Player timeline strip: owns the playback clock, filmstrip, and playhead; wired to the controls bar and keyboard via window events, and drives the workbench via `show-command`. */
@customElement(COMPONENT)
export class TraceTimeline extends Element {
  @consume({ context: commandContext, subscribe: true })
  @state()
  commands: CommandLog[] = []

  @consume({ context: framesContext, subscribe: true })
  @state()
  frames: TracePlayerFrame[] = []

  /** Playback position in ms relative to the recording start. */
  @state() currentMs = 0
  @state() playing = false
  @state() speed = 1

  #rafId?: number
  #rafLast = 0
  #activeCommand?: CommandLog
  #started = false

  @query('[data-scrub]') scrubEl?: HTMLElement

  #dragging = false

  static styles = [...Element.styles, timelineStyles]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(KBD.togglePlay, this.#onKbdTogglePlay)
    window.addEventListener(KBD.step, this.#onKbdStep)
    window.addEventListener(KBD.jump, this.#onKbdJump)
    window.addEventListener(KBD.speed, this.#onKbdSpeed)
    window.addEventListener(PLAYER_RESTART_EVENT, this.#onRestartEvent)
    window.addEventListener(PLAYER_SPEED_EVENT, this.#onSpeedEvent)
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
    window.removeEventListener(PLAYER_RESTART_EVENT, this.#onRestartEvent)
    window.removeEventListener(PLAYER_SPEED_EVENT, this.#onSpeedEvent)
  }

  #onRestartEvent = (): void => this.#restart()
  #onSpeedEvent = (event: Event): void => {
    this.speed = (event as CustomEvent<{ value: number }>).detail.value
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
    // Mirror playback state to the controls bar on the tab-header line.
    window.dispatchEvent(
      new CustomEvent<PlayerState>(PLAYER_STATE_EVENT, {
        detail: {
          currentMs: this.currentMs,
          duration: this.#duration,
          playing: this.playing,
          speed: this.speed
        }
      })
    )
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
    const command = activeSpanAt(sorted, clock) ?? sorted[0]
    if (this.#started && command === this.#activeCommand) {
      return
    }
    this.#started = true
    this.#activeCommand = command
    window.dispatchEvent(
      new CustomEvent('show-command', { detail: { command } })
    )
  }

  // ─── scrubbing (drag anywhere on the strip) ───────────────────────────────

  #fractionFromClientX(clientX: number): number {
    const rect = this.scrubEl?.getBoundingClientRect()
    if (!rect || rect.width <= 0) {
      return 0
    }
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
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

  get #ticks(): number[] {
    const step = tickStep(this.#duration)
    const out: number[] = []
    for (let t = step; t < this.#duration; t += step) {
      out.push(t)
    }
    return out
  }

  // Faint vertical gridlines at each ruler tick, spanning the whole strip.
  #renderGridlines(): TemplateResult {
    return html`${this.#ticks.map(
      (tick) =>
        html`<div
          class="absolute top-0 bottom-0 w-px bg-panelBorder/60 pointer-events-none"
          style="left:${(tick / this.#duration) * 100}%;"
        ></div>`
    )}`
  }

  // Ruler labels stay inside the strip via the bounded translateX trick.
  #renderRulerLabels(): TemplateResult {
    return html`
      <div class="relative h-5 flex-none text-[10px] opacity-70">
        ${this.#ticks.map((tick) => {
          const fraction = tick / this.#duration
          return html`<span
            class="absolute top-0.5 whitespace-nowrap"
            style="left:${fraction * 100}%; transform:translateX(-${fraction *
            100}%);"
            >${formatTickLabel(tick)}</span
          >`
        })}
      </div>
    `
  }

  // Thumbnails sit at their wall-clock position along the axis.
  #renderThumbTrack(): TemplateResult {
    if (!this.frames.length) {
      return html`<div
        class="flex-1 min-h-0 flex items-center justify-center text-[11px] opacity-50"
      >
        No frames captured
      </div>`
    }
    const activeFrame = this.#activeFrameTimestamp
    return html`
      <div class="relative flex-1 min-h-0">
        ${this.frames.map((frame) => {
          const fraction = this.#fraction(frame.timestamp)
          const active = frame.timestamp === activeFrame
          return html`<button
            class="absolute top-0.5 bottom-0.5 aspect-video border rounded overflow-hidden hover:border-chartsBlue hover:z-10 ${active
              ? 'border-chartsBlue ring-1 ring-chartsBlue z-10'
              : 'border-panelBorder'}"
            style="left:${fraction * 100}%; transform:translateX(-${fraction *
            100}%);"
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
        })}
      </div>
    `
  }

  // Bottom scrub bar: full-width line, action tick marks, draggable knob.
  #renderScrubBar(): TemplateResult {
    const fraction = Math.min(1, Math.max(0, this.currentMs / this.#duration))
    return html`
      <div class="relative h-6 flex-none">
        <div
          class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-chartsBlue/50 rounded"
        ></div>
        ${this.#sortedCommands.map((command) => {
          const tickFraction = this.#fraction(command.timestamp ?? 0)
          return html`<div
            class="absolute top-1/2 -translate-y-1/2 h-2.5 w-px bg-white/80"
            style="left:${tickFraction * 100}%;"
            title="${command.title ?? command.command}"
          ></div>`
        })}
        <div
          class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-chartsBlue ring-1 ring-white/70 pointer-events-none"
          style="left:calc(${fraction * 100}% - 6px);"
        ></div>
      </div>
    `
  }

  render() {
    return html`
      <div
        data-scrub
        class="relative flex-1 min-h-0 flex flex-col cursor-ew-resize select-none"
        @pointerdown="${this.#onPointerDown}"
      >
        ${this.#renderGridlines()} ${this.#renderRulerLabels()}
        ${this.#renderThumbTrack()} ${this.#renderScrubBar()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: TraceTimeline
  }
}
