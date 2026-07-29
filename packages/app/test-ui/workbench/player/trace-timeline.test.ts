import type { CommandLog, TracePlayerFrame } from '@wdio/devtools-shared'

import { commandContext, framesContext } from '@/controller/context.js'
import { KBD } from '@/controller/keyboard.js'
import {
  PLAYER_RESTART_EVENT,
  PLAYER_SPEED_EVENT,
  PLAYER_STATE_EVENT,
  type PlayerState
} from '@components/browser/trace-timeline-constants.js'
import '@components/browser/trace-timeline.js'

import { mountWithContext, settle } from '../../support/mount.js'
import { shadow, shadowAll, text, texts } from '../../support/queries.js'
import { filmstrip, FRAME_SHOT, loginTrace } from './fixtures.js'

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
  timelineFrames: TracePlayerFrame[]
): Promise<Timeline> {
  return mountWithContext<Timeline>(TAG, [
    { context: commandContext, value: timelineCommands },
    { context: framesContext, value: timelineFrames }
  ])
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

/** The action the strip asks the workbench to show next. */
function nextShownCommand(): Promise<CommandLog> {
  return new Promise((resolve) => {
    window.addEventListener(
      'show-command',
      (event) => resolve(event.detail.command),
      { once: true }
    )
  })
}

const attrs = (els: Element[], name: string) =>
  els.map((el) => el.getAttribute(name))

const lefts = (els: HTMLElement[]) => els.map((el) => el.style.left)

const isActive = (thumb: HTMLElement) => thumb.classList.contains('ring-1')

describe('wdio-devtools-trace-timeline', () => {
  describe('filmstrip', () => {
    it('renders one thumbnail per captured frame, timecoded from the start', async () => {
      const el = await mountTimeline(commands, frames)

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

      expect(lefts(shadowAll(el, THUMB))).toEqual([
        '0%',
        '25%',
        '37.5%',
        '62.5%',
        '100%'
      ])
    })

    it("renders each frame's screenshot as its thumbnail", async () => {
      const el = await mountTimeline(commands, frames)

      expect(shadow(el, `${THUMB} img`)?.getAttribute('src')).toBe(
        `data:image/png;base64,${FRAME_SHOT}`
      )
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

    it('draws one gridline per ruler tick', async () => {
      const el = await mountTimeline(commands, frames)

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
})
