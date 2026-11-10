import type { CommandLog, TracePlayerFrame } from '@wdio/devtools-shared'

import {
  commandContext,
  framesContext,
  playerArchiveContext,
  type PlayerArchive
} from '@/controller/context.js'
import { KBD } from '@/controller/keyboard.js'
import {
  PLAYER_RESTART_EVENT,
  PLAYER_SEEK_ACTION_EVENT,
  PLAYER_SPEED_EVENT,
  PLAYER_STATE_EVENT,
  type PlayerState
} from '@components/browser/trace-timeline-constants.js'
import {
  formatTickLabel,
  formatTimecode,
  tickStep
} from '@components/browser/trace-timeline-utils.js'
import '@components/browser/trace-timeline.js'

import { mountWithContext, settle } from '../../support/mount.js'
import { playerArchive } from '../../support/trace-archive.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import {
  filmstrip,
  FRAME_IMAGES,
  loginTrace,
  PORTRAIT_CAPTURE
} from './fixtures.js'

const TAG = 'wdio-devtools-trace-timeline'
const STRIP = '[data-scrub]'
const THUMB = '[data-scrub] button'
const GRIDLINE = 'div.w-px'
const TICK_LABEL = 'span.absolute'
/** Action marks are the only titled divs; the thumbnails are buttons. */
const MARK = 'div[title]'
/** The playhead knob is the only div rounded by a class. */
const PLAYHEAD = 'div.rounded-full'

type Timeline = HTMLElementTagNameMap[typeof TAG]

const { commands, openLogin, typeUsername, readFlash } = loginTrace
const { frames, first, typing, last } = filmstrip
/** Origin and span of the strip's window, as the component derives them. */
const START = first.timestamp
const DURATION = last.timestamp - START

function mountTimeline(
  timelineCommands: CommandLog[],
  timelineFrames: TracePlayerFrame[],
  archive: PlayerArchive = playerArchive(FRAME_IMAGES)
): Promise<Timeline> {
  return mountWithContext<Timeline>(TAG, [
    { context: commandContext, value: timelineCommands },
    { context: framesContext, value: timelineFrames },
    { context: playerArchiveContext, value: archive }
  ])
}

/** The thumbnails' images once each has been read from the zip and decoded. */
async function loadedThumbs(el: Timeline): Promise<HTMLImageElement[]> {
  for (let tick = 0; tick < 100; tick++) {
    await settle(el)
    const images = shadowAll<HTMLImageElement>(el, `${THUMB} img`)
    if (
      images.length === shadowAll(el, THUMB).length &&
      images.every((img) => img.complete && img.naturalWidth > 0)
    ) {
      return images
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the thumbnails never loaded')
}

/** The clock the strip mirrors to the controls bar on its next render. */
function nextPlayerState(): Promise<PlayerState> {
  return new Promise((resolve) => {
    window.addEventListener(
      PLAYER_STATE_EVENT,
      (event) => resolve((event as CustomEvent<PlayerState>).detail),
      { once: true }
    )
  })
}

/** The next `show-command` the strip announces, whole: the workbench reads the
 *  command, the Logs panel badges the elapsed offset that comes with it. */
function nextShowCommand(): Promise<CommandEventProps> {
  return new Promise((resolve) => {
    window.addEventListener('show-command', (event) => resolve(event.detail), {
      once: true
    })
  })
}

/** The action the strip asks the workbench to show next. */
const nextShownCommand = (): Promise<CommandLog> =>
  nextShowCommand().then((detail) => detail.command)

const attrs = (els: Element[], name: string) =>
  els.map((el) => el.getAttribute(name))

const lefts = (els: HTMLElement[]) => els.map((el) => el.style.left)

/** Where the strip puts a wall-clock timestamp: its share of the window, from
 *  the same origin and span the component derives. */
const at = (timestamp: number) => `${((timestamp - START) / DURATION) * 100}%`

/** Ruler ticks as the strip lays them out — one every `tickStep(duration)`, up
 *  to but not including the end of the window. */
function rulerTicks(duration: number): number[] {
  const step = tickStep(duration)
  const ticks: number[] = []
  for (let tick = step; tick < duration; tick += step) {
    ticks.push(tick)
  }
  return ticks
}

const byTimestamp = (entries: CommandLog[]) =>
  [...entries].sort((a, b) => a.timestamp - b.timestamp)

const isActive = (thumb: HTMLElement) => thumb.classList.contains('ring-1')

describe('wdio-devtools-trace-timeline', () => {
  describe('filmstrip', () => {
    it('renders one thumbnail per captured frame, timecoded from the start', async () => {
      const el = await mountTimeline(commands, frames)

      // Derived, so a strip that timecoded from the wrong origin — or stopped
      // running its labels through the shared formatter — fails here.
      expect(attrs(shadowAll(el, THUMB), 'title')).toEqual(
        frames.map((frame) => formatTimecode(frame.timestamp - START))
      )
      // ...and pinned, so the derivation can't drift along with a broken
      // formatter. These are the fixture's designed offsets: 0/500/750/1250/2000.
      expect(attrs(shadowAll(el, THUMB), 'title')).toEqual([
        '0:00.00',
        '0:00.50',
        '0:00.75',
        '0:01.25',
        '0:02.00'
      ])
    })

    it('positions each thumbnail at its share of the recording', async () => {
      const el = await mountTimeline(commands, frames)

      expect(lefts(shadowAll(el, THUMB))).toEqual(
        frames.map((frame) => at(frame.timestamp))
      )
      expect(lefts(shadowAll(el, THUMB))).toEqual([
        '0%',
        '25%',
        '37.5%',
        '62.5%',
        '100%'
      ])
    })

    it("renders each frame's image, read from the zip, as its thumbnail", async () => {
      const archive = playerArchive(FRAME_IMAGES)
      const el = await mountTimeline(commands, frames, archive)

      const images = await loadedThumbs(el)

      expect(images.map((img) => img.getAttribute('src'))).toEqual(
        frames.map((frame) => archive.entries.cachedUrl(frame.entry))
      )
      expect(images[0]!.src).toMatch(/^blob:/)
    })

    it('holds a placeholder for a frame not read yet', async () => {
      const el = await mountTimeline(commands, frames, playerArchive({}))

      expect(shadowAll(el, `${THUMB} img`)).toHaveLength(0)
      expect(shadowAll(el, THUMB)).toHaveLength(frames.length)
    })

    it('draws no more frames than the entry cache holds at once', async () => {
      const archive = playerArchive(FRAME_IMAGES)
      const big = playerArchive(
        FRAME_IMAGES,
        undefined,
        archive.entries.maxBytes / 4
      )
      const el = await mountTimeline(commands, frames, big)

      expect(shadowAll(el, THUMB)).toHaveLength(3)
    })

    it('reads no image when even one frame is larger than its share of the cache', async () => {
      const archive = playerArchive(FRAME_IMAGES)
      const huge = playerArchive(
        FRAME_IMAGES,
        undefined,
        archive.entries.maxBytes * 2
      )
      const el = await mountTimeline(commands, frames, huge)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await settle(el)

      expect(shadowAll(el, THUMB).length).toBeGreaterThan(0)
      expect(shadowAll(el, `${THUMB} img`)).toHaveLength(0)
      expect(huge.entries.cachedUrl(frames[0]!.entry)).toBeUndefined()
    })

    it('releases its frames to the cache when it leaves the page', async () => {
      const images = {
        ...FRAME_IMAGES,
        'resources/other.png': FRAME_IMAGES['resources/frame.png']!
      }
      const archive = playerArchive(images, undefined, undefined, 1)
      const el = await mountTimeline(commands, frames, archive)
      await loadedThumbs(el)

      el.remove()
      await archive.entries.url('resources/other.png')

      expect(archive.entries.cachedUrl(frames[0]!.entry)).toBeUndefined()
    })

    it('draws no more frames than fit the strip', async () => {
      const many = Array.from({ length: 400 }, (_, i) => ({
        timestamp: START + i * 5,
        entry: frames[i % frames.length]!.entry
      }))
      const el = await mountTimeline(commands, many)
      el.style.width = '300px'
      el.style.height = '100px'
      // The strip is measured by a ResizeObserver, which reports after layout.
      for (let frame = 0; frame < 30; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        await settle(el)
        if (shadowAll(el, THUMB).length < many.length / 4) {
          break
        }
      }

      const drawn = shadowAll(el, THUMB)
      expect(drawn.length).toBeLessThan(many.length / 4)
      expect(drawn[0]!.style.left).toBe('0%')
      expect(drawn[drawn.length - 1]!.style.left).toBe('100%')
    })

    it('marks the frame nearest the playhead as the active one', async () => {
      const el = await mountTimeline(commands, frames)
      const thumbs = shadowAll(el, THUMB)

      expect(isActive(thumbs[0])).toBe(true)
      expect(thumbs.filter(isActive)).toHaveLength(1)
    })

    it('moves the active frame to the thumbnail clicked', async () => {
      const el = await mountTimeline(commands, frames)

      shadowAll(el, THUMB)[3].click()
      await settle(el)

      const thumbs = shadowAll(el, THUMB)
      expect(isActive(thumbs[3])).toBe(true)
      expect(isActive(thumbs[0])).toBe(false)
    })

    it('says so when the trace captured no frames', async () => {
      const el = await mountTimeline(commands, [])

      expect(shadowAll(el, THUMB)).toHaveLength(0)
      expect(text(shadow(el, STRIP))).toContain('No frames captured')
    })

    it('renders a single captured frame at the start of the strip', async () => {
      const el = await mountTimeline([], [first])
      const thumbs = shadowAll(el, THUMB)

      expect(thumbs).toHaveLength(1)
      expect(thumbs[0].style.left).toBe('0%')
      expect(isActive(thumbs[0])).toBe(true)
    })

    /**
     * A thumbnail box is filled by the frame, so its shape decides what survives:
     * in a fixed 16:9 box a portrait capture was cropped to a horizontal band
     * through its middle — empty page on a phone screen, so the strip rendered as
     * blank rectangles. The shape is read from the capture's own pixels, which is
     * also all a DOM-less trace has: it carries no viewport, and on mobile the
     * viewport disagrees with the screenshot anyway.
     */
    describe('thumbnail shape', () => {
      /** Height for the strip to lay out in — the component is auto-height, and
       *  a collapsed strip makes every ratio below 0/0. */
      const STRIP_HEIGHT = 200

      const shapeOf = (thumb: HTMLElement) => {
        const box = thumb.getBoundingClientRect()
        return box.width / box.height
      }

      async function laidOutStrip(
        frameSize: PlayerArchive['frameSize']
      ): Promise<Timeline> {
        const el = await mountTimeline(
          commands,
          frames,
          playerArchive(FRAME_IMAGES, frameSize)
        )
        el.style.height = `${STRIP_HEIGHT}px`
        el.style.width = '600px'
        await settle(el)
        return el
      }

      it("takes the capture's own shape, as the reader measured it", async () => {
        const el = await laidOutStrip(PORTRAIT_CAPTURE)

        const portrait = PORTRAIT_CAPTURE.width / PORTRAIT_CAPTURE.height
        for (const thumb of shadowAll(el, THUMB)) {
          expect(shapeOf(thumb)).toBeCloseTo(portrait, 2)
        }
      })

      it('keeps nothing cropped away', async () => {
        const el = await laidOutStrip(PORTRAIT_CAPTURE)
        await loadedThumbs(el)
        const thumb = shadowAll(el, THUMB)[0]
        const img = shadow<HTMLImageElement>(thumb, 'img')!

        // The frame fills its box rather than being covered into it, so the box
        // holding the capture's shape means the whole capture is on screen.
        expect(getComputedStyle(img).objectFit).toBe('contain')
        expect(img.getBoundingClientRect().height).toBeCloseTo(
          thumb.getBoundingClientRect().height,
          1
        )
      })

      it('falls back to 16:9 when the bytes name no size', async () => {
        const el = await laidOutStrip(undefined)

        expect(shapeOf(shadowAll(el, THUMB)[0])).toBeCloseTo(16 / 9, 2)
      })
    })
  })

  describe('action marks', () => {
    it('orders the marks by timestamp, whatever order the commands arrived in', async () => {
      const el = await mountTimeline([...commands].reverse(), frames)

      expect(attrs(shadowAll(el, MARK), 'title')).toEqual([
        'url',
        '$',
        'setValue',
        'click',
        // The last command carries a display title, which wins over its name.
        readFlash.title
      ])
    })

    it('positions each mark at its share of the recording', async () => {
      const el = await mountTimeline(commands, frames)

      // A mark sits at its command's END, not its start — the two differ for
      // every spanned command in the fixture, so a mark drawn from `startTime`
      // moves every position here.
      expect(lefts(shadowAll(el, MARK))).toEqual(
        byTimestamp(commands).map((command) => at(command.timestamp))
      )
      expect(lefts(shadowAll(el, MARK))).toEqual([
        '20%',
        '32%',
        '39%',
        '63%',
        '76%'
      ])
    })

    it('gives a typing command the keyboard glyph', async () => {
      const el = await mountTimeline(commands, frames)

      expect(shadowAll(el, MARK)[2].style.backgroundColor).toBe(
        'rgb(70, 201, 106)'
      )
    })

    it('gives a command with a hit point the pointer dot', async () => {
      const el = await mountTimeline(commands, frames)

      expect(shadowAll(el, MARK)[3].style.borderRadius).toBe('50%')
    })

    it('gives every other command a plain tick', async () => {
      const el = await mountTimeline(commands, frames)

      expect(shadowAll(el, MARK)[0].style.width).toBe('1px')
    })

    it('renders no marks for a trace without commands', async () => {
      const el = await mountTimeline([], frames)

      expect(shadowAll(el, MARK)).toHaveLength(0)
    })
  })

  describe('ruler', () => {
    it('labels the ruler at the interval that fits the recording', async () => {
      const el = await mountTimeline(commands, frames)

      // 2000ms over the 14 divisions the ruler aims for lands on the 250ms step.
      expect(tickStep(DURATION)).toBe(250)
      expect(texts(el, TICK_LABEL)).toEqual(
        rulerTicks(DURATION).map(formatTickLabel)
      )
      expect(texts(el, TICK_LABEL)).toEqual([
        '250ms',
        '500ms',
        '750ms',
        '1.0s',
        '1.3s',
        '1.5s',
        '1.8s'
      ])
    })

    it('positions each ruler label at its tick', async () => {
      const el = await mountTimeline(commands, frames)

      expect(lefts(shadowAll(el, TICK_LABEL))).toEqual(
        rulerTicks(DURATION).map((tick) => `${(tick / DURATION) * 100}%`)
      )
    })

    it('draws one gridline per ruler tick', async () => {
      const el = await mountTimeline(commands, frames)

      expect(shadowAll(el, GRIDLINE)).toHaveLength(rulerTicks(DURATION).length)
      expect(shadowAll(el, GRIDLINE)).toHaveLength(7)
    })

    it('draws no ruler at all for an empty trace', async () => {
      const el = await mountTimeline([], [])

      expect(texts(el, TICK_LABEL)).toEqual([])
      expect(shadowAll(el, GRIDLINE)).toHaveLength(0)
      expect(text(shadow(el, STRIP))).toContain('No frames captured')
    })
  })

  describe('selection', () => {
    it('announces the first action as soon as commands arrive', async () => {
      const shown = nextShownCommand()

      await mountTimeline(commands, frames)

      expect(await shown).toEqual(openLogin)
    })

    it('announces the action running at the frame clicked', async () => {
      const el = await mountTimeline(commands, frames)
      const shown = nextShownCommand()

      shadowAll(el, THUMB)[frames.indexOf(typing)].click()

      expect(await shown).toEqual(typeUsername)
    })

    it('times the first action from itself, so its badge reads zero', async () => {
      const shown = nextShowCommand()

      await mountTimeline(commands, frames)

      // Placed by the strip itself as the trace opens, so the dock keeps its tab.
      expect(await shown).toEqual({
        command: openLogin,
        elapsedTime: 0,
        keepTab: true
      })
    })

    it('times the announced action from the first command, as the actions list does', async () => {
      const el = await mountTimeline(commands, frames)
      const shown = nextShowCommand()

      shadowAll(el, THUMB)[frames.indexOf(typing)].click()

      // The offset the Logs panel badges, derived the way actions.ts derives the
      // one it sends on a row click: from the first COMMAND. The strip's own
      // window starts 400ms earlier (at the first captured frame), so measuring
      // from that origin would badge 780ms for this action instead of 380ms and
      // the same action would read differently in the two panes.
      expect(await shown).toEqual({
        command: typeUsername,
        elapsedTime: typeUsername.timestamp - openLogin.timestamp
      })
      expect((await shown).elapsedTime).toBe(380)
    })

    it('does not re-announce the action already selected', async () => {
      const el = await mountTimeline(commands, frames)
      let announced = 0
      const count = () => {
        announced += 1
      }
      window.addEventListener('show-command', count)

      // The frame at 500ms still falls after `url` and before `$`.
      shadowAll(el, THUMB)[1].click()
      await settle(el)
      window.removeEventListener('show-command', count)

      expect(announced).toBe(0)
    })
  })

  describe('playback clock', () => {
    it('steps the clock to the next action', async () => {
      const el = await mountTimeline(commands, frames)
      const state = nextPlayerState()

      window.dispatchEvent(new CustomEvent(KBD.step, { detail: { dir: 1 } }))
      await settle(el)

      expect((await state).currentMs).toBe(openLogin.timestamp - START)
    })

    it('jumps the clock to the end of the recording', async () => {
      const el = await mountTimeline(commands, frames)
      const state = nextPlayerState()

      window.dispatchEvent(new CustomEvent(KBD.jump, { detail: { to: 'end' } }))
      await settle(el)

      expect(await state).toMatchObject({
        currentMs: DURATION,
        duration: DURATION
      })
    })

    it('parks the playhead at the clock position', async () => {
      const el = await mountTimeline(commands, frames)

      window.dispatchEvent(new CustomEvent(KBD.jump, { detail: { to: 'end' } }))
      await settle(el)

      expect(shadow(el, PLAYHEAD)?.style.left).toBe('calc(100% - 6px)')
    })

    it('returns the clock to the start on restart', async () => {
      const el = await mountTimeline(commands, frames)
      const jumped = nextPlayerState()
      window.dispatchEvent(new CustomEvent(KBD.jump, { detail: { to: 'end' } }))
      await jumped

      const restarted = nextPlayerState()
      window.dispatchEvent(new CustomEvent(PLAYER_RESTART_EVENT))
      await settle(el)

      expect(await restarted).toMatchObject({ currentMs: 0, playing: false })
    })

    it('takes its playback speed from the controls bar', async () => {
      const el = await mountTimeline(commands, frames)
      const state = nextPlayerState()

      window.dispatchEvent(
        new CustomEvent(PLAYER_SPEED_EVENT, { detail: { value: 2 } })
      )
      await settle(el)

      expect((await state).speed).toBe(2)
    })

    it('reports playing while the clock runs and stops on the second toggle', async () => {
      await mountTimeline(commands, frames)

      const started = nextPlayerState()
      window.dispatchEvent(new CustomEvent(KBD.togglePlay))
      expect((await started).playing).toBe(true)

      const stopped = nextPlayerState()
      window.dispatchEvent(new CustomEvent(KBD.togglePlay))
      expect((await stopped).playing).toBe(false)
    })
  })

  describe('following a trace link', () => {
    const withIds = (list: CommandLog[]) =>
      list.map((command, i) => ({ ...command, callId: `call@${i + 1}` }))
    const seek = (callId: string) =>
      window.dispatchEvent(
        new CustomEvent<string>(PLAYER_SEEK_ACTION_EVENT, { detail: callId })
      )

    it('moves to the linked action, keeping the dock tab', async () => {
      const linked = withIds(commands)
      const target = linked[commands.indexOf(typeUsername)]
      const el = await mountTimeline(linked, frames)
      const shown = nextShowCommand()

      seek(target.callId)

      const detail = await shown
      expect(detail.command).toBe(target)
      expect(detail.keepTab).toBe(true)
      expect(el.currentMs).toBe(target.timestamp - START)
    })

    it('keeps the linked action when the first frame re-syncs at the same clock', async () => {
      const linked = withIds(commands)
      const target = linked[commands.indexOf(typeUsername)]
      const seen: CommandLog[] = []
      const record = (event: CustomEvent<CommandEventProps>) =>
        seen.push(event.detail.command)

      const el = await mountTimeline(linked, frames)
      window.addEventListener('show-command', record)
      seek(target.callId)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await settle(el)
      window.removeEventListener('show-command', record)

      expect(seen).toEqual([target])
    })

    it('restarts from the first action after following a link', async () => {
      const linked = withIds(commands)
      await mountTimeline(linked, frames)
      seek(linked[commands.indexOf(readFlash)].callId)
      const shown = nextShownCommand()

      window.dispatchEvent(new CustomEvent(PLAYER_RESTART_EVENT))

      expect(await shown).toBe(linked[commands.indexOf(openLogin)])
    })

    it('announces the last action again when played through after a link to it', async () => {
      // No frames, so the last action ends the recording and the link parks the clock at its end.
      const linked = withIds(commands)
      const sorted = [...linked].sort((a, b) => a.timestamp - b.timestamp)
      const last = sorted[sorted.length - 1]
      const el = await mountTimeline(linked, [])
      seek(last.callId)
      await settle(el)
      window.dispatchEvent(
        new CustomEvent(PLAYER_SPEED_EVENT, { detail: { value: 5 } })
      )
      const seen: CommandLog[] = []
      const record = (event: CustomEvent<CommandEventProps>) =>
        seen.push(event.detail.command)
      window.addEventListener('show-command', record)

      window.dispatchEvent(new CustomEvent(KBD.togglePlay))
      const deadline = Date.now() + 5_000
      while ((el.playing || !seen.length) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      window.removeEventListener('show-command', record)

      expect(seen[seen.length - 1]).toBe(last)
    })

    it('ignores an id the trace does not hold', async () => {
      const el = await mountTimeline(withIds(commands), frames)
      const before = el.currentMs
      let announced = 0
      const count = () => announced++
      window.addEventListener('show-command', count)

      seek('call@99')
      await settle(el)
      window.removeEventListener('show-command', count)

      expect(announced).toBe(0)
      expect(el.currentMs).toBe(before)
    })
  })
})
