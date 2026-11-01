import type { CommandLog } from '@wdio/devtools-shared'

import { commandContext } from '@/controller/context.js'
import '@components/browser/screencast-player.js'
import type { ScreencastPlayer } from '@components/browser/screencast-player.js'

import { mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import { loginTrace, RECORDING, VIDEO_SESSION_ID } from './fixtures.js'

const TAG = 'wdio-devtools-screencast-player'
/** The endpoint the snapshot view points the player at. */
const RECORDING_URL = `/api/video/${VIDEO_SESSION_ID}`
const PLAY = '.scrub-play'
const CLOCK = '.scrub-time'
const TRACK = '.scrub-track'
const FILL = '.scrub-fill'
const HEAD = '.scrub-head'
/** One per action pinned onto the recording's timeline. */
const MARKER = '.scrub-marker'

/** Length of the encoded video, in seconds. Deliberately unlike the recording's
 *  2000ms span: the player maps video time onto the captured window rather than
 *  reading one as the other, and equal numbers would hide a swap. */
const VIDEO_SECONDS = 60

interface Inputs {
  src?: string
  startTime?: number
  duration?: number
  commands?: CommandLog[]
}

function mountPlayer(inputs: Inputs = {}): Promise<ScreencastPlayer> {
  return mountWithContext<ScreencastPlayer>(
    TAG,
    [{ context: commandContext, value: inputs.commands ?? [] }],
    {
      src: inputs.src ?? '',
      startTime: inputs.startTime,
      duration: inputs.duration
    }
  )
}

/** A player already pointed at the fixture recording, over the whole run. */
const mountRecording = (commands: CommandLog[] = []) =>
  mountPlayer({ src: RECORDING_URL, ...RECORDING, commands })

function video(el: ScreencastPlayer): HTMLVideoElement {
  const found = shadow<HTMLVideoElement>(el, 'video')
  if (!found) {
    throw new Error('the player rendered no video element')
  }
  return found
}

/** Times the component asked the recording to start and stop. */
interface Media {
  play: number
  pause: number
}

/**
 * Stands in for the parts of the `<video>` a test drives, then fires the media
 * event that hands them to the component. The runner serves no video, so a real
 * media element here reports `duration: NaN` and never leaves `paused`, and
 * everything downstream of those two is unreachable. Only the media element is
 * stubbed: the clock, the markers, the progress events and the glyph are all
 * still produced by the component's own handlers off the real events below.
 */
async function loadRecording(
  el: ScreencastPlayer,
  seconds = VIDEO_SECONDS
): Promise<Media> {
  const media = video(el)
  const calls: Media = { play: 0, pause: 0 }
  let currentTime = 0
  let paused = true
  Object.defineProperties(media, {
    duration: { configurable: true, get: () => seconds },
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      }
    },
    paused: { configurable: true, get: () => paused },
    play: {
      configurable: true,
      value: () => {
        calls.play += 1
        paused = false
        media.dispatchEvent(new Event('play'))
        return Promise.resolve()
      }
    },
    pause: {
      configurable: true,
      value: () => {
        calls.pause += 1
        paused = true
        media.dispatchEvent(new Event('pause'))
      }
    }
  })
  media.dispatchEvent(new Event('loadedmetadata'))
  await settle(el)
  return calls
}

/** Wall-clock timestamps the player announced while `act` ran — what the actions
 *  list highlights the playing action from. */
function progressTimes(act: () => void): number[] {
  const times: number[] = []
  const listener = (event: Event) =>
    times.push((event as CustomEvent<{ time: number }>).detail.time)
  window.addEventListener('app-screencast-progress', listener)
  try {
    act()
  } finally {
    window.removeEventListener('app-screencast-progress', listener)
  }
  return times
}

/** The same, for an interaction the driver has to perform. */
async function progressWhile(act: () => Promise<void>): Promise<number[]> {
  const times: number[] = []
  const listener = (event: Event) =>
    times.push((event as CustomEvent<{ time: number }>).detail.time)
  window.addEventListener('app-screencast-progress', listener)
  try {
    await act()
  } finally {
    window.removeEventListener('app-screencast-progress', listener)
  }
  return times
}

/** Presses the track at a share of its width, as a pointer does. */
function pressTrack(el: ScreencastPlayer, fraction: number): void {
  const track = shadow(el, TRACK)
  if (!track) {
    throw new Error('the player rendered no scrub track')
  }
  const rect = track.getBoundingClientRect()
  track.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: rect.left + rect.width * fraction,
      bubbles: true
    })
  )
}

/** Continues a press already begun, so the captured pointer keeps seeking. */
function dragTrack(el: ScreencastPlayer, fraction: number): void {
  const track = shadow(el, TRACK)!
  const rect = track.getBoundingClientRect()
  track.dispatchEvent(
    new PointerEvent('pointermove', {
      pointerId: 1,
      clientX: rect.left + rect.width * fraction,
      bubbles: true
    })
  )
}

/**
 * Presses and drags across the track with a REAL pointer. Chrome grants pointer
 * capture to a trusted pointer only — after a synthetic `setPointerCapture(1)`
 * the element's `hasPointerCapture(1)` is still false — and the drag is gated on
 * exactly that, so the driver has to move this one. Offsets are measured from
 * the element's centre.
 */
async function dragAcrossTrack(
  el: ScreencastPlayer,
  from: number,
  to: number
): Promise<void> {
  const width = shadow(el, TRACK)!.getBoundingClientRect().width
  const offset = (fraction: number) => Math.round((fraction - 0.5) * width)
  const handle = await $(`>>> ${TRACK}`)
  await browser
    .action('pointer')
    .move({ origin: handle, x: offset(from), y: 0 })
    .down()
    .move({ origin: handle, x: offset(to), y: 0 })
    .up()
    .perform()
}

/** How far a dragged position may land from the share asked for: the driver moves
 *  in whole pixels, and one pixel of a track this wide is ~4ms of the window. */
const DRAG_TOLERANCE_MS = 20

const offBy = (announced: number, expected: number) =>
  Math.abs(announced - expected)

const lefts = (el: ScreencastPlayer, selector: string) =>
  shadowAll<HTMLElement>(el, selector).map((node) => node.style.left)

const titles = (el: ScreencastPlayer, selector: string) =>
  shadowAll(el, selector).map((node) => node.getAttribute('title'))

const clock = (el: ScreencastPlayer) => text(shadow(el, CLOCK))

/** The pane is 500px narrower than the window in the runner's page, and the
 *  track only takes what is left over from the play button and the clock — wide
 *  enough to press a fraction of, but pinned here so a press lands on the same
 *  geometry whatever the window size. */
async function widen(el: ScreencastPlayer): Promise<void> {
  const host = el.parentElement
  if (!host) {
    throw new Error('the mounted player has no host to size')
  }
  host.style.width = '600px'
  await settle(el)
}

describe('wdio-devtools-screencast-player', () => {
  describe('before a recording arrives', () => {
    it('shows a stopped, empty scrubber', async () => {
      const el = await mountPlayer()

      expect(video(el).getAttribute('src')).toBe('')
      expect(clock(el)).toBe('0:00 / 0:00')
      expect(shadow(el, PLAY)?.getAttribute('title')).toBe('Play')
      expect(text(shadow(el, PLAY))).toBe('▶')
      expect(shadow<HTMLElement>(el, FILL)?.style.width).toBe('0%')
      expect(shadowAll(el, MARKER)).toHaveLength(0)
    })

    it('plays the recording it is pointed at', async () => {
      const el = await mountRecording()

      expect(video(el).getAttribute('src')).toBe(RECORDING_URL)
    })

    it('shows the length of the recording once its metadata loads', async () => {
      const el = await mountRecording()

      await loadRecording(el)

      // The encoded video's own length, not the captured window's 2000ms.
      expect(clock(el)).toBe('0:00 / 1:00')
    })
  })

  /**
   * Each action is pinned onto the recording by the moment it ran, mapped through
   * the captured window (`startTime` + `duration`) rather than the video's own
   * length — the two differ deliberately here.
   */
  describe('actions on the timeline', () => {
    it('pins one marker per action at its moment in the recording', async () => {
      const el = await mountRecording(loginTrace.commands)

      // The fixture's actions start 0/600/700/1200/1500ms into a 2000ms
      // recording, so every marker lands on an exact percentage.
      expect(lefts(el, MARKER)).toEqual(['0%', '30%', '35%', '60%', '75%'])
      expect(titles(el, MARKER)).toEqual([
        'url',
        '$',
        'setValue',
        'click',
        'getText'
      ])
    })

    it('pins nothing while the recording window is still unknown', async () => {
      const el = await mountPlayer({
        src: RECORDING_URL,
        commands: loginTrace.commands
      })

      // The snapshot view renders the player before the `screencast-ready`
      // message that carries the window, so this is a state it really passes
      // through — with no scale, a marker could only sit at the wrong place.
      expect(shadowAll(el, MARKER)).toHaveLength(0)
      expect(clock(el)).toBe('0:00 / 0:00')
    })

    it("seeks the recording to the action's own moment when its marker is pressed", async () => {
      const el = await mountRecording(loginTrace.commands)
      await loadRecording(el)

      const announced = progressTimes(() =>
        shadowAll(el, MARKER)[3].dispatchEvent(
          new PointerEvent('pointerdown', { pointerId: 1, bubbles: true })
        )
      )
      await settle(el)

      // Exactly the action's own start time — and exactly one announcement, so
      // the press did not also reach the track underneath and seek twice.
      expect(announced).toEqual([loginTrace.submit.startTime])
      expect(clock(el)).toBe('0:36 / 1:00')
      expect(shadow<HTMLElement>(el, FILL)?.style.width).toBe('60%')
    })
  })

  describe('scrubbing', () => {
    it('seeks to the point on the track pressed', async () => {
      const el = await mountRecording()
      await widen(el)
      await loadRecording(el)

      const announced = progressTimes(() => pressTrack(el, 0.25))
      await settle(el)

      // A quarter into the recording window, in wall-clock ms — what the actions
      // list needs to highlight the action playing at this frame.
      expect(announced).toHaveLength(1)
      expect(announced[0]).toBeCloseTo(RECORDING.startTime + 500, 0)
      // A quarter into the video, in its own seconds.
      expect(clock(el)).toBe('0:15 / 1:00')
      expect(lefts(el, HEAD)).toEqual(['25%'])
    })

    it('keeps seeking while the pointer is dragged across the track', async () => {
      const el = await mountRecording()
      await widen(el)
      await loadRecording(el)

      const announced = await progressWhile(() =>
        dragAcrossTrack(el, 0.25, 0.75)
      )

      // Both ends of the drag: a quarter into the recording on the press, three
      // quarters once the pointer has moved.
      expect(announced).toHaveLength(2)
      expect(offBy(announced[0], RECORDING.startTime + 500)).toBeLessThan(
        DRAG_TOLERANCE_MS
      )
      expect(offBy(announced[1], RECORDING.startTime + 1500)).toBeLessThan(
        DRAG_TOLERANCE_MS
      )
    })

    it('ignores a pointer crossing the track with no press in progress', async () => {
      const el = await mountRecording()
      await widen(el)
      await loadRecording(el)

      const announced = progressTimes(() => dragTrack(el, 0.75))
      await settle(el)

      // Merely moving over the scrubber must not move the recording.
      expect(announced).toEqual([])
      expect(clock(el)).toBe('0:00 / 1:00')
    })

    it('stops at either end for a scrub that runs off the track', async () => {
      const el = await mountRecording()
      await widen(el)
      await loadRecording(el)

      const before = progressTimes(() => pressTrack(el, -0.5))
      const after = progressTimes(() => pressTrack(el, 1.5))
      await settle(el)

      expect(before).toEqual([RECORDING.startTime])
      expect(after).toEqual([RECORDING.startTime + RECORDING.duration])
      expect(clock(el)).toBe('1:00 / 1:00')
      expect(lefts(el, HEAD)).toEqual(['100%'])
    })

    it('announces nothing until the recording has a length to seek within', async () => {
      const el = await mountRecording()
      await widen(el)

      const announced = progressTimes(() => pressTrack(el, 0.5))
      await settle(el)

      // No metadata yet, so there is no frame to name: a fraction of an unknown
      // length would announce the recording's start for every press.
      expect(announced).toEqual([])
      expect(clock(el)).toBe('0:00 / 0:00')
      expect(shadow<HTMLElement>(el, FILL)?.style.width).toBe('0%')
    })
  })

  describe('playback', () => {
    it('starts the recording from the play control', async () => {
      const el = await mountRecording()
      const media = await loadRecording(el)

      shadow<HTMLButtonElement>(el, PLAY)?.click()
      await settle(el)

      expect(media.play).toBe(1)
      // The control now offers the opposite action.
      expect(shadow(el, PLAY)?.getAttribute('title')).toBe('Pause')
      expect(text(shadow(el, PLAY))).toBe('❚❚')
    })

    it('stops it again from the same control', async () => {
      const el = await mountRecording()
      const media = await loadRecording(el)

      shadow<HTMLButtonElement>(el, PLAY)?.click()
      await settle(el)
      shadow<HTMLButtonElement>(el, PLAY)?.click()
      await settle(el)

      expect(media).toEqual({ play: 1, pause: 1 })
      expect(shadow(el, PLAY)?.getAttribute('title')).toBe('Play')
    })

    it('toggles playback when the picture itself is clicked', async () => {
      const el = await mountRecording()
      const media = await loadRecording(el)

      video(el).click()
      await settle(el)

      expect(media.play).toBe(1)
    })

    it('announces the frame playing as the recording runs', async () => {
      const el = await mountRecording()
      await loadRecording(el)
      shadow<HTMLButtonElement>(el, PLAY)?.click()
      await settle(el)

      const media = video(el)
      media.currentTime = VIDEO_SECONDS / 2
      const announced = progressTimes(() =>
        media.dispatchEvent(new Event('timeupdate'))
      )
      await settle(el)

      expect(announced).toEqual([RECORDING.startTime + RECORDING.duration / 2])
      expect(clock(el)).toBe('0:30 / 1:00')
    })

    it('stays quiet on the timeupdate a loading video fires while paused', async () => {
      const el = await mountRecording()
      await loadRecording(el)

      const media = video(el)
      const announced = progressTimes(() =>
        media.dispatchEvent(new Event('timeupdate'))
      )
      await settle(el)

      // A video fires one timeupdate at 0:00 as it loads. Announcing that would
      // highlight the first action the moment a recording appears — on run
      // completion, with nothing playing.
      expect(announced).toEqual([])
    })
  })
})
