import { KBD } from '@/controller/keyboard.js'
import '@components/browser/trace-player-controls.js'
import type { TracePlayerControls } from '@components/browser/trace-player-controls.js'
import {
  PLAYER_RESTART_EVENT,
  PLAYER_SPEED_EVENT,
  PLAYER_STATE_EVENT,
  SPEEDS,
  type PlayerState
} from '@components/browser/trace-timeline-constants.js'
import { formatTimecode } from '@components/browser/trace-timeline-utils.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'

const TAG = 'wdio-devtools-trace-player-controls'
const TIMECODE = 'code'
const CONTROL = 'button[title]'
const SPEED_SELECT = 'select'
const SPEED_OPTION = 'select option'

/** The clock the timeline strip broadcasts; the bar only mirrors it. */
function broadcast(state: Partial<PlayerState> = {}): void {
  window.dispatchEvent(
    new CustomEvent<PlayerState>(PLAYER_STATE_EVENT, {
      detail: { currentMs: 0, duration: 0, playing: false, speed: 1, ...state }
    })
  )
}

async function mountControls(
  state?: Partial<PlayerState>
): Promise<TracePlayerControls> {
  const el = await mount<TracePlayerControls>(TAG)
  if (state) {
    broadcast(state)
    await settle(el)
  }
  return el
}

function control(el: TracePlayerControls, title: string): HTMLButtonElement {
  const button = shadow<HTMLButtonElement>(el, `button[title="${title}"]`)
  if (!button) {
    throw new Error(`no control rendered for "${title}"`)
  }
  return button
}

function speedSelect(el: TracePlayerControls): HTMLSelectElement {
  const select = shadow<HTMLSelectElement>(el, SPEED_SELECT)
  if (!select) {
    throw new Error('no speed control rendered')
  }
  return select
}

const titles = (el: TracePlayerControls) =>
  shadowAll(el, CONTROL).map((button) => button.getAttribute('title'))

/** What the bar asks the timeline to do, off `window`. */
function capture<T>(type_: string, act: () => void): CustomEvent<T>[] {
  const received: CustomEvent<T>[] = []
  const listener = (event: Event) => received.push(event as CustomEvent<T>)
  window.addEventListener(type_, listener)
  try {
    act()
  } finally {
    window.removeEventListener(type_, listener)
  }
  return received
}

describe('wdio-devtools-trace-player-controls', () => {
  describe('the clock', () => {
    it('starts at zero with the recording length still unknown', async () => {
      const el = await mountControls()

      expect(texts(el, TIMECODE)).toEqual(['0:00.00', '0:00.00'])
    })

    it('mirrors the clock the timeline broadcasts', async () => {
      const position = 32_270
      const length = 61_000
      const el = await mountControls({
        currentMs: position,
        duration: length
      })

      // Derived, so a bar that swapped the two codes or read either straight off
      // the state without the shared formatter fails here...
      expect(texts(el, TIMECODE)).toEqual([
        formatTimecode(position),
        formatTimecode(length)
      ])
      // ...and pinned, so the derivation cannot drift with a broken formatter.
      expect(texts(el, TIMECODE)).toEqual(['0:32.27', '1:01.00'])
    })

    it('stops mirroring the clock once it leaves the page', async () => {
      const el = await mountControls()
      el.remove()

      broadcast({ currentMs: 5_000, duration: 9_000 })
      await settle(el)

      expect(el.playerState.currentMs).toBe(0)
      expect(texts(el, TIMECODE)).toEqual(['0:00.00', '0:00.00'])
    })
  })

  describe('the controls', () => {
    it('offers restart, both steps and playback in playback order', async () => {
      const el = await mountControls()

      expect(titles(el)).toEqual([
        'Restart',
        'Previous action',
        'Play',
        'Next action'
      ])
    })

    it('offers to play while the recording is paused', async () => {
      const el = await mountControls({ playing: false })

      expect(shadowAll(el, 'icon-mdi-play')).toHaveLength(1)
      expect(shadowAll(el, 'icon-mdi-pause')).toHaveLength(0)
    })

    it('offers to pause while the recording plays', async () => {
      const el = await mountControls({ playing: true })

      expect(titles(el)).toContain('Pause')
      expect(shadowAll(el, 'icon-mdi-pause')).toHaveLength(1)
      expect(shadowAll(el, 'icon-mdi-play')).toHaveLength(0)
    })

    it('asks the timeline to start playing', async () => {
      const el = await mountControls()

      const received = capture(KBD.togglePlay, () =>
        control(el, 'Play').click()
      )

      expect(received).toHaveLength(1)
    })

    it('asks the timeline to stop again from the same control', async () => {
      const el = await mountControls({ playing: true })

      const received = capture(KBD.togglePlay, () =>
        control(el, 'Pause').click()
      )

      expect(received).toHaveLength(1)
    })

    it('steps the timeline back one action', async () => {
      const el = await mountControls({ currentMs: 4_000, duration: 9_000 })

      const received = capture<{ dir: number }>(KBD.step, () =>
        control(el, 'Previous action').click()
      )

      expect(received.map((event) => event.detail.dir)).toEqual([-1])
    })

    it('steps the timeline forward one action', async () => {
      const el = await mountControls({ currentMs: 4_000, duration: 9_000 })

      const received = capture<{ dir: number }>(KBD.step, () =>
        control(el, 'Next action').click()
      )

      expect(received.map((event) => event.detail.dir)).toEqual([1])
    })

    it('asks the timeline to restart the recording', async () => {
      const el = await mountControls({ currentMs: 9_000, duration: 9_000 })

      const received = capture(PLAYER_RESTART_EVENT, () =>
        control(el, 'Restart').click()
      )

      expect(received).toHaveLength(1)
    })

    /**
     * The bar owns no bounds state — where the playhead sits is the timeline's
     * business, and clamping a step is too. So the controls keep driving it at
     * either end, and these three cases pin that by the EVENT each click sends:
     * a `?disabled` binding appearing in the bar would swallow the click and
     * every one of them fails. Asserting `button.disabled` instead cannot fail —
     * the bar renders no such binding, so the value is a constant.
     */
    it('still steps back with the playhead at the start of the recording', async () => {
      const el = await mountControls({ currentMs: 0, duration: 9_000 })

      const received = capture<{ dir: number }>(KBD.step, () =>
        control(el, 'Previous action').click()
      )

      expect(received.map((event) => event.detail.dir)).toEqual([-1])
    })

    it('still steps forward with the playhead at the end of the recording', async () => {
      const el = await mountControls({ currentMs: 9_000, duration: 9_000 })

      const received = capture<{ dir: number }>(KBD.step, () =>
        control(el, 'Next action').click()
      )

      expect(received.map((event) => event.detail.dir)).toEqual([1])
    })

    it('drives the timeline from every control for a recording of no length', async () => {
      const el = await mountControls({ currentMs: 0, duration: 0 })

      const stepped = capture<{ dir: number }>(KBD.step, () => {
        control(el, 'Previous action').click()
        control(el, 'Next action').click()
      })
      const restarted = capture(PLAYER_RESTART_EVENT, () =>
        control(el, 'Restart').click()
      )
      const toggled = capture(KBD.togglePlay, () => control(el, 'Play').click())

      expect(stepped.map((event) => event.detail.dir)).toEqual([-1, 1])
      expect(restarted).toHaveLength(1)
      expect(toggled).toHaveLength(1)
    })
  })

  describe('playback speed', () => {
    it('offers every speed the player supports', async () => {
      const el = await mountControls()

      expect(texts(el, SPEED_OPTION)).toEqual(
        SPEEDS.map((speed) => `${speed}×`)
      )
    })

    it('plays at single speed until told otherwise', async () => {
      const el = await mountControls()

      expect(speedSelect(el).value).toBe('1')
    })

    it('shows the speed the timeline broadcasts', async () => {
      const el = await mountControls({ speed: 2 })

      expect(speedSelect(el).value).toBe('2')
      expect(text(shadow(el, 'select option[selected]'))).toBe('2×')
    })

    it('asks the timeline for the speed picked', async () => {
      const el = await mountControls()
      const select = speedSelect(el)

      const received = capture<{ value: number }>(PLAYER_SPEED_EVENT, () => {
        select.value = '3'
        select.dispatchEvent(new Event('change'))
      })

      expect(received.map((event) => event.detail.value)).toEqual([3])
    })
  })
})
