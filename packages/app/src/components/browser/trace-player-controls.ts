import { Element } from '@core/element'
import { html, css, type TemplateResult } from 'lit'
import { customElement, state } from 'lit/decorators.js'

import { emit, KBD } from '../../controller/keyboard.js'
import {
  PLAYER_RESTART_EVENT,
  PLAYER_SPEED_EVENT,
  PLAYER_STATE_EVENT,
  SPEEDS,
  type PlayerState
} from './trace-timeline-constants.js'
import { formatTimecode } from './trace-timeline-utils.js'

import '~icons/mdi/play.js'
import '~icons/mdi/pause.js'
import '~icons/mdi/skip-previous.js'
import '~icons/mdi/skip-next.js'
import '~icons/mdi/restart.js'

const COMPONENT = 'wdio-devtools-trace-player-controls'

/** Playback controls bar; drives the timeline via window events and mirrors its broadcast state. */
@customElement(COMPONENT)
export class TracePlayerControls extends Element {
  @state() playerState: PlayerState = {
    currentMs: 0,
    duration: 0,
    playing: false,
    speed: 1
  }

  static styles = [
    ...Element.styles,
    css`
      :host {
        display: flex;
        align-items: center;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-foreground);
      }
    `
  ]

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener(PLAYER_STATE_EVENT, this.#onState)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener(PLAYER_STATE_EVENT, this.#onState)
  }

  #onState = (event: Event): void => {
    this.playerState = (event as CustomEvent<PlayerState>).detail
  }

  #button(
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

  #renderSpeedSelect(speed: number): TemplateResult {
    return html`
      <select
        class="ml-1 bg-sideBarBackground border border-panelBorder rounded px-1 py-0.5"
        title="Playback speed"
        @change="${(event: Event) =>
          emit(PLAYER_SPEED_EVENT, {
            value: Number((event.target as HTMLSelectElement).value)
          })}"
      >
        ${SPEEDS.map(
          (value) =>
            html`<option value="${value}" ?selected="${value === speed}">
              ${value}×
            </option>`
        )}
      </select>
    `
  }

  render() {
    const { currentMs, duration, playing, speed } = this.playerState
    return html`
      <div class="flex items-center gap-1 px-2 w-full text-[12px]">
        <code class="tabular-nums text-chartsYellow"
          >${formatTimecode(currentMs)}</code
        >
        <span class="opacity-60">/</span>
        <code class="tabular-nums opacity-80">${formatTimecode(duration)}</code>
        <span class="ml-auto"></span>
        ${this.#button(
          'Restart',
          html`<icon-mdi-restart></icon-mdi-restart>`,
          () => emit(PLAYER_RESTART_EVENT)
        )}
        ${this.#button(
          'Previous action',
          html`<icon-mdi-skip-previous></icon-mdi-skip-previous>`,
          () => emit(KBD.step, { dir: -1 })
        )}
        ${this.#button(
          playing ? 'Pause' : 'Play',
          playing
            ? html`<icon-mdi-pause></icon-mdi-pause>`
            : html`<icon-mdi-play></icon-mdi-play>`,
          () => emit(KBD.togglePlay),
          'text-chartsBlue'
        )}
        ${this.#button(
          'Next action',
          html`<icon-mdi-skip-next></icon-mdi-skip-next>`,
          () => emit(KBD.step, { dir: 1 })
        )}
        ${this.#renderSpeedSelect(speed)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [COMPONENT]: TracePlayerControls
  }
}
