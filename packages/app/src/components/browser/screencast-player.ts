import { Element } from '@core/element'
import { css, html } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import type { CommandLog } from '@wdio/devtools-shared'

import { commandContext } from '../../controller/context.js'
import { computeMarkers, formatClock } from './scrubber.js'

const COMPONENT = 'wdio-devtools-screencast-player'

/**
 * Screencast video player with a custom scrubber: play/pause, `m:ss / m:ss`
 * time, an orange progress bar with drag-seek, and per-command markers pinned
 * to the recording timeline. Owns the `<video>` element and all playback state;
 * the parent only supplies `src` and the recording window (`startTime`/
 * `duration`). Markers come from the shared command context.
 */
@customElement(COMPONENT)
export class ScreencastPlayer extends Element {
  /** `/api/video/:sessionId` URL of the recording to play. */
  @property({ type: String }) src = ''
  /** Unix ms timestamp of the recording's first frame (marker origin). */
  @property({ type: Number }) startTime?: number
  /** Recording span in ms (marker scale). */
  @property({ type: Number }) duration?: number

  @consume({ context: commandContext, subscribe: true })
  commands: CommandLog[] = []

  @state() private currentTime = 0
  @state() private videoDuration = 0
  @state() private playing = false

  @query('video')
  video?: HTMLVideoElement

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      video {
        flex: 1;
        min-height: 0;
        width: 100%;
        object-fit: contain;
        background: #111;
        display: block;
        cursor: pointer;
      }

      .scrubber {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        padding: 10px 14px;
        background: var(--vscode-sideBar-background);
        border-top: 1px solid var(--vscode-panel-border, #262b33);
        border-radius: 0 0 14px 14px;
      }

      .scrub-play {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background: var(--accent, #ff7a3c);
        color: var(--accent-foreground, #0d0f12);
        cursor: pointer;
        font-size: 13px;
        line-height: 0;
        transition: background 0.1s;
      }

      .scrub-play:hover {
        background: var(--accent-hover, #ff9a66);
      }

      .scrub-time {
        flex-shrink: 0;
        font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: var(--vscode-descriptionForeground, #8a929c);
        min-width: 64px;
      }

      .scrub-track {
        position: relative;
        flex: 1;
        height: 28px;
        display: flex;
        align-items: center;
        cursor: pointer;
        touch-action: none;
      }

      .scrub-rail {
        position: absolute;
        left: 0;
        right: 0;
        height: 5px;
        border-radius: 999px;
        background: color-mix(
          in srgb,
          var(--vscode-panel-border, #262b33) 70%,
          #000
        );
      }

      .scrub-fill {
        position: absolute;
        left: 0;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--accent-hover, #ff9a66),
          var(--accent, #ff7a3c)
        );
        pointer-events: none;
      }

      .scrub-head {
        position: absolute;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 0 4px
          color-mix(in srgb, var(--accent, #ff7a3c) 35%, transparent);
        transform: translateX(-50%);
        pointer-events: none;
      }

      .scrub-marker {
        position: absolute;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        transform: translateX(-50%);
        border: 2px solid var(--vscode-sideBar-background);
        cursor: pointer;
        background: var(--vscode-foreground, #ccc);
      }

      .scrub-marker:hover {
        transform: translateX(-50%) scale(1.35);
      }

      .scrub-marker.navigation {
        background: var(--vscode-charts-blue, #4daafc);
      }
      .scrub-marker.input {
        background: var(
          --color-chartsPurple,
          var(--vscode-charts-purple, #b180d7)
        );
      }
      .scrub-marker.assertion {
        background: var(--vscode-charts-green, #89d185);
      }
      .scrub-marker.query {
        background: var(--vscode-charts-yellow, #e2c08d);
      }
      .scrub-marker.other {
        background: var(--vscode-descriptionForeground, #8a929c);
      }
    `
  ]

  #togglePlay() {
    const video = this.video
    if (!video) {
      return
    }
    if (video.paused) {
      void video.play()
    } else {
      video.pause()
    }
  }

  #onLoaded = () => {
    this.videoDuration = this.video?.duration ?? 0
  }

  #onTime = () => {
    this.currentTime = this.video?.currentTime ?? 0
    this.#emitProgress()
  }

  /**
   * Broadcast the current playback position as a wall-clock ms timestamp so the
   * action timeline can highlight the action playing at this frame. Mapped via
   * the recording window rather than raw video time so it stays correct even if
   * the encoded video's duration drifts slightly from the captured span.
   */
  #emitProgress() {
    if (
      typeof this.startTime !== 'number' ||
      !this.duration ||
      !this.videoDuration
    ) {
      return
    }
    const fraction = this.currentTime / this.videoDuration
    const time = this.startTime + fraction * this.duration
    window.dispatchEvent(
      new CustomEvent('app-screencast-progress', { detail: { time } })
    )
  }

  #onPlayState = () => {
    this.playing = !!this.video && !this.video.paused
  }

  /** Seek the video to a fraction (0–1) of its duration. */
  #seekTo(fraction: number) {
    const video = this.video
    if (!video || !video.duration) {
      return
    }
    const clamped = Math.max(0, Math.min(1, fraction))
    video.currentTime = clamped * video.duration
  }

  #seekFromPointer(ev: PointerEvent) {
    const track = ev.currentTarget as HTMLElement
    const rect = track.getBoundingClientRect()
    if (!rect.width) {
      return
    }
    this.#seekTo((ev.clientX - rect.left) / rect.width)
  }

  #onTrackPointerDown = (ev: PointerEvent) => {
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    this.#seekFromPointer(ev)
  }

  #onTrackPointerMove = (ev: PointerEvent) => {
    const track = ev.currentTarget as HTMLElement
    if (!track.hasPointerCapture(ev.pointerId)) {
      return
    }
    this.#seekFromPointer(ev)
  }

  #renderScrubber() {
    const pct = this.videoDuration
      ? (this.currentTime / this.videoDuration) * 100
      : 0
    const markers =
      typeof this.startTime === 'number' && this.duration
        ? computeMarkers(this.commands, this.startTime, this.duration)
        : []
    return html`
      <div class="scrubber">
        <button
          class="scrub-play"
          title=${this.playing ? 'Pause' : 'Play'}
          @click=${() => this.#togglePlay()}
        >
          ${this.playing ? '❚❚' : '▶'}
        </button>
        <span class="scrub-time">
          ${formatClock(this.currentTime)} / ${formatClock(this.videoDuration)}
        </span>
        <div
          class="scrub-track"
          @pointerdown=${this.#onTrackPointerDown}
          @pointermove=${this.#onTrackPointerMove}
        >
          <div class="scrub-rail"></div>
          <div class="scrub-fill" style="width: ${pct}%"></div>
          <div class="scrub-head" style="left: ${pct}%"></div>
          ${markers.map(
            (m) =>
              html`<span
                class="scrub-marker ${m.category}"
                style="left: ${m.fraction * 100}%"
                title=${m.label}
                @pointerdown=${(ev: PointerEvent) => {
                  ev.stopPropagation()
                  this.#seekTo(m.fraction)
                }}
              ></span>`
          )}
        </div>
      </div>
    `
  }

  render() {
    return html`
      <video
        src=${this.src}
        @loadedmetadata=${this.#onLoaded}
        @durationchange=${this.#onLoaded}
        @timeupdate=${this.#onTime}
        @play=${this.#onPlayState}
        @pause=${this.#onPlayState}
        @click=${() => this.#togglePlay()}
      ></video>
      ${this.#renderScrubber()}
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: ScreencastPlayer
  }
}
