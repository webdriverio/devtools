import '@components/shortcuts-overlay.js'
import type { DevtoolsShortcuts } from '@components/shortcuts-overlay.js'

import { mount, settle } from '../support/mount.js'
import { shadow, shadowAll, text, texts } from '../support/queries.js'

const OVERLAY = 'wdio-devtools-shortcuts'
const BACKDROP = '.backdrop'
const PANEL = '.panel'
const TITLE = 'header'
const CLOSE = 'header .x'
const KEY = 'dt kbd'
const DESCRIPTION = 'dd'
const DIMMED = 'dd.dim'

/** The overlay's own table, restated: `SHORTCUTS` is module-private and this is
 *  the copy the user reads. Player-only rows come first. */
const KEYS = ['Space', '← / →', 'Home / End', ', / .', '/', '?']
const DESCRIPTIONS = [
  'Play / pause',
  'Previous / next action',
  'First / last action',
  'Slower / faster',
  'Focus filter',
  'Toggle this help'
]
const PLAYER_ONLY = DESCRIPTIONS.slice(0, 4)

async function mountOverlay(
  props: { open?: boolean; playerMode?: boolean } = {}
): Promise<DevtoolsShortcuts> {
  const overlay = await mount<DevtoolsShortcuts>(OVERLAY, {
    open: true,
    ...props
  })
  await settle(overlay)
  return overlay
}

/** `close` is dispatched on the overlay itself and does not bubble. */
async function closeEvents(
  overlay: DevtoolsShortcuts,
  act: () => void
): Promise<Event[]> {
  const received: Event[] = []
  const listener = (event: Event) => received.push(event)
  overlay.addEventListener('close', listener)
  try {
    act()
    await settle(overlay)
  } finally {
    overlay.removeEventListener('close', listener)
  }
  return received
}

const pressEscape = (): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true
  })
  window.dispatchEvent(event)
  return event
}

describe('wdio-devtools-shortcuts', () => {
  describe('open state', () => {
    it('renders nothing at all while it is closed', async () => {
      const overlay = await mountOverlay({ open: false })

      expect(shadowAll(overlay, BACKDROP)).toHaveLength(0)
      expect(shadowAll(overlay, KEY)).toHaveLength(0)
    })

    it('renders the dialog over a backdrop once it is opened', async () => {
      const overlay = await mountOverlay({ open: false })

      overlay.open = true
      await settle(overlay)

      expect(shadowAll(overlay, BACKDROP)).toHaveLength(1)
      expect(shadowAll(overlay, PANEL)).toHaveLength(1)
      expect(text(shadow(overlay, TITLE))).toBe('Keyboard shortcuts ✕')
    })

    it('tears the dialog back down when it is closed again', async () => {
      const overlay = await mountOverlay()

      overlay.open = false
      await settle(overlay)

      expect(shadowAll(overlay, BACKDROP)).toHaveLength(0)
    })
  })

  describe('keybinding list', () => {
    it('lists every shortcut key once, in order', async () => {
      const overlay = await mountOverlay()

      expect(texts(overlay, KEY)).toEqual(KEYS)
    })

    it('pairs each key with the action it performs', async () => {
      const overlay = await mountOverlay()

      expect(texts(overlay, DESCRIPTION)).toEqual(DESCRIPTIONS)
    })

    it('dims the playback shortcuts in the live dashboard, where they no-op', async () => {
      const overlay = await mountOverlay({ playerMode: false })

      expect(texts(overlay, DIMMED)).toEqual(PLAYER_ONLY)
    })

    it('dims nothing in the trace player, where every key works', async () => {
      const overlay = await mountOverlay({ playerMode: true })

      expect(shadowAll(overlay, DIMMED)).toHaveLength(0)
      expect(texts(overlay, DESCRIPTION)).toEqual(DESCRIPTIONS)
    })

    it('undims the playback shortcuts when the player takes over', async () => {
      const overlay = await mountOverlay({ playerMode: false })

      overlay.playerMode = true
      await settle(overlay)

      expect(shadowAll(overlay, DIMMED)).toHaveLength(0)
    })
  })

  describe('closing', () => {
    it('asks to close when the backdrop is clicked', async () => {
      const overlay = await mountOverlay()

      const received = await closeEvents(overlay, () =>
        shadow(overlay, BACKDROP)?.click()
      )

      expect(received).toHaveLength(1)
    })

    it('asks to close when the ✕ is clicked', async () => {
      const overlay = await mountOverlay()

      const received = await closeEvents(overlay, () =>
        shadow(overlay, CLOSE)?.click()
      )

      expect(received).toHaveLength(1)
    })

    it('stays open when the dialog itself is clicked', async () => {
      const overlay = await mountOverlay()

      const received = await closeEvents(overlay, () =>
        shadow(overlay, PANEL)?.click()
      )

      expect(received).toHaveLength(0)
      expect(shadowAll(overlay, BACKDROP)).toHaveLength(1)
    })

    it('asks to close on Escape and swallows the key', async () => {
      const overlay = await mountOverlay()
      let escape: KeyboardEvent | undefined

      const received = await closeEvents(overlay, () => {
        escape = pressEscape()
      })

      expect(received).toHaveLength(1)
      expect(escape?.defaultPrevented).toBe(true)
    })

    it('ignores Escape while it is closed', async () => {
      const overlay = await mountOverlay({ open: false })
      let escape: KeyboardEvent | undefined

      const received = await closeEvents(overlay, () => {
        escape = pressEscape()
      })

      expect(received).toHaveLength(0)
      expect(escape?.defaultPrevented).toBe(false)
    })

    it('ignores any other key while it is open', async () => {
      const overlay = await mountOverlay()

      const received = await closeEvents(overlay, () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
        )
      )

      expect(received).toHaveLength(0)
    })

    it('stops listening for Escape once it leaves the DOM', async () => {
      const overlay = await mountOverlay()
      overlay.remove()

      const received = await closeEvents(overlay, () => pressEscape())

      expect(received).toHaveLength(0)
    })
  })
})
