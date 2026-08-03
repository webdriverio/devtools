import type { CommandLog } from '@wdio/devtools-shared'

import '@components/workbench/actionItems/command.js'
import type { CommandItem } from '@components/workbench/actionItems/command.js'
import { entryDuration } from '@components/workbench/actionItems/duration.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import { commandLog } from '../../support/builders.js'

const TAG = 'wdio-devtools-command-item'
const LABEL = 'code'
const BADGE = '.ml-auto'

describe('wdio-devtools-command-item', () => {
  describe('label', () => {
    it('renders no row without an entry', async () => {
      const el = await mount<CommandItem>(TAG, {})

      expect(shadowAll(el, 'button').length).toBe(0)
    })

    it('renders the raw command name when the entry has no title', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })

      expect(text(shadow(el, LABEL))).toBe('click')
    })

    it('prefers the entry title so the label keeps its arguments', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({
          command: 'setValue',
          args: ['#user', 'admin'],
          title: 'Element.setValue("#user", "admin")'
        })
      })

      expect(text(shadow(el, LABEL))).toBe('Element.setValue("#user", "admin")')
    })

    it('renders the command name when the entry has no arguments', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'getUrl', args: [] })
      })

      expect(text(shadow(el, LABEL))).toBe('getUrl')
    })

    it('capitalizes a leading assert prefix in the label', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'assert.equal' })
      })

      expect(text(shadow(el, LABEL))).toBe('Assert.equal')
    })

    it('capitalizes a leading expect prefix in the label', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'expect', title: 'expect.toHaveText' })
      })

      expect(text(shadow(el, LABEL))).toBe('Expect.toHaveText')
    })

    it('capitalizes a leading verify prefix in the label', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'verify.containsText' })
      })

      expect(text(shadow(el, LABEL))).toBe('Verify.containsText')
    })

    it('leaves an assertion prefix untouched when it is not at the start', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'run', title: 'chained expect.toBe' })
      })

      expect(text(shadow(el, LABEL))).toBe('chained expect.toBe')
    })
  })

  describe('icon', () => {
    it('renders the navigation icon and colour for a url command', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'url' })
      })

      const icon = shadow(el, 'icon-mdi-arrow-top-right')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsBlue')).toBe(true)
    })

    it('renders the reload icon rather than the navigation icon for refresh', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'refresh' })
      })

      expect(shadow(el, 'icon-mdi-refresh')).toBeTruthy()
      expect(shadowAll(el, 'icon-mdi-arrow-top-right').length).toBe(0)
    })

    it('renders the input icon and colour for a click command', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })

      const icon = shadow(el, 'icon-mdi-cursor-default-click-outline')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsPurple')).toBe(true)
    })

    it('renders the keyboard icon for a setValue command', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'setValue' })
      })

      const icon = shadow(el, 'icon-mdi-keyboard-outline')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsPurple')).toBe(true)
    })

    it('renders the select icon and query colour for an element lookup', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: '$' })
      })

      const icon = shadow(el, 'icon-mdi-target')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsYellow')).toBe(true)
    })

    it('renders the read icon and query colour for a getText command', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'getText' })
      })

      const icon = shadow(el, 'icon-mdi-text')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsYellow')).toBe(true)
    })

    it('renders the check icon and assertion colour for an expect command', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'expect.toHaveText' })
      })

      const icon = shadow(el, 'icon-mdi-check-circle-outline')
      expect(icon).toBeTruthy()
      expect(icon?.classList.contains('text-chartsGreen')).toBe(true)
    })

    it('falls back to the generic icon with no category colour', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'executeScript' })
      })

      const icon = shadow(el, 'icon-mdi-code-tags')
      expect(icon).toBeTruthy()
      expect(icon?.getAttribute('class')).not.toContain('text-charts')
    })
  })

  describe('state', () => {
    it('leaves the row unmarked when the entry has no error', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })

      expect(el.hasAttribute('failed')).toBe(false)
      expect(shadow(el, LABEL)?.classList.contains('text-chartsRed')).toBe(
        false
      )
    })

    it('marks the row failed and reddens the label when the entry errored', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({
          command: 'click',
          error: new Error('element not interactable')
        })
      })

      expect(el.hasAttribute('failed')).toBe(true)
      expect(shadow(el, LABEL)?.classList.contains('text-chartsRed')).toBe(true)
      expect(
        shadow(el, 'icon-mdi-cursor-default-click-outline')?.classList.contains(
          'text-chartsRed'
        )
      ).toBe(true)
    })

    it("swaps a failed assertion's check icon for a cross", async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({
          command: 'expect.toHaveText',
          error: new Error('expected "a" to equal "b"')
        })
      })

      expect(shadow(el, 'icon-mdi-close-circle-outline')).toBeTruthy()
      expect(shadowAll(el, 'icon-mdi-check-circle-outline').length).toBe(0)
    })

    it('clears the failed state when the entry is replaced by a passing one', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click', error: new Error('boom') })
      })
      expect(el.hasAttribute('failed')).toBe(true)

      el.entry = commandLog({ command: 'click' })
      await settle(el)

      expect(el.hasAttribute('failed')).toBe(false)
      expect(shadow(el, LABEL)?.classList.contains('text-chartsRed')).toBe(
        false
      )
    })

    it('reflects the active state as an attribute', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        active: true
      })

      expect(el.hasAttribute('active')).toBe(true)
    })

    it('is inactive by default', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })

      expect(el.hasAttribute('active')).toBe(false)
    })
  })

  describe('duration', () => {
    it('omits the duration badge when no duration is known', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })

      expect(shadowAll(el, BADGE).length).toBe(0)
    })

    it('renders a zero-length step as 0ms in the fast bucket', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        duration: 0
      })

      expect(text(shadow(el, BADGE))).toBe('0ms')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsGreen')).toBe(
        true
      )
    })

    it('buckets a step just under 500ms as fast', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        duration: 499
      })

      expect(text(shadow(el, BADGE))).toBe('499ms')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsGreen')).toBe(
        true
      )
    })

    it('buckets a step at exactly 500ms as mid', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        duration: 500
      })

      expect(text(shadow(el, BADGE))).toBe('500ms')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsYellow')).toBe(
        true
      )
    })

    it('keeps a step just under 2s in the mid bucket', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        duration: 1999
      })

      // Reads below the boundary it is below: rounding to `2.00s` put the same
      // label as the slow bucket's first value on a yellow badge.
      expect(text(shadow(el, BADGE))).toBe('1.99s')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsYellow')).toBe(
        true
      )
    })

    it('buckets a step at exactly 2s as slow', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' }),
        duration: 2000
      })

      expect(text(shadow(el, BADGE))).toBe('2.00s')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsRed')).toBe(true)
    })

    it('renders a step over a minute in minutes and seconds', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'waitUntil' }),
        duration: 65_000
      })

      expect(text(shadow(el, BADGE))).toBe('1m 5s')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsRed')).toBe(true)
    })

    it("shows the command's own span rather than the gap to the next action", async () => {
      const entry = commandLog({
        command: 'expect.toHaveText',
        startTime: 1000,
        timestamp: 1120
      })
      // The panel hands the row `entryDuration`'s answer, so the row is fed the
      // real derivation over a 4s gap fallback — not a number chosen to match.
      const duration = entryDuration(entry, 4000)
      const el = await mount<CommandItem>(TAG, { entry, duration })

      expect(duration).toBe(120)
      expect(text(shadow(el, BADGE))).toBe('120ms')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsGreen')).toBe(
        true
      )
    })

    it('falls back to the inter-action gap when the entry has no start time', async () => {
      const entry = commandLog({ command: 'click', timestamp: 1120 })
      const duration = entryDuration(entry, 750)
      const el = await mount<CommandItem>(TAG, { entry, duration })

      expect(duration).toBe(750)
      expect(text(shadow(el, BADGE))).toBe('750ms')
      expect(shadow(el, BADGE)?.classList.contains('text-chartsYellow')).toBe(
        true
      )
    })
  })

  describe('events', () => {
    it('dispatches show-command on window with the entry and elapsed time', async () => {
      const entry = commandLog({ command: 'click' })
      const el = await mount<CommandItem>(TAG, { entry, elapsedTime: 1250 })
      const received: CustomEvent<{
        command: CommandLog
        elapsedTime?: number
      }>[] = []
      const listener = (event: Event) => received.push(event as CustomEvent)

      window.addEventListener('show-command', listener)
      try {
        shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
      } finally {
        window.removeEventListener('show-command', listener)
      }

      expect(received.length).toBe(1)
      expect(received[0]?.detail.command).toBe(entry)
      expect(received[0]?.detail.elapsedTime).toBe(1250)
    })

    it('announces a zero elapsed time when it was handed none', async () => {
      const el = await mount<CommandItem>(TAG, {
        entry: commandLog({ command: 'click' })
      })
      const received: CommandEventProps[] = []
      const listener = (event: Event) =>
        received.push((event as CustomEvent<CommandEventProps>).detail)

      window.addEventListener('show-command', listener)
      try {
        shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
      } finally {
        window.removeEventListener('show-command', listener)
      }

      // The contract declares a number, and the Log tab drops its duration chip
      // for `undefined` — so a row with no offset of its own announces the start
      // of its list, not "no answer".
      expect(received.length).toBe(1)
      expect(received[0].elapsedTime).toBe(0)
    })
  })
})
