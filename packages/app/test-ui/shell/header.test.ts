import { DARK_MODE_KEY } from '@/controller/constants.js'
import { prefersDarkMode } from '@/controller/theme.js'
import '@components/header.js'
import type { DevtoolsHeader } from '@components/header.js'

import { mount, settle } from '../support/mount.js'
import { shadow, shadowAll, text } from '../support/queries.js'

const HEADER = 'wdio-devtools-header'
const LOGO = 'icon-custom-logo'
const TITLE = 'h1'
const THEME_BUTTON = 'nav button'
const MOON = 'icon-mdi-moon-waning-crescent'
const SUN = 'icon-mdi-white-balance-sunny'

const isDark = () => document.body.classList.contains('dark')
const storedTheme = () => localStorage.getItem(DARK_MODE_KEY)
const osPrefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

/** Each header derives its theme when it is CONSTRUCTED, so a spec picks the
 *  theme it mounts into by storing one first — no module-load ordering to work
 *  around, and both initial states fit in one file. */
function store(theme: 'dark' | 'light'): void {
  localStorage.setItem(DARK_MODE_KEY, theme === 'dark' ? 'true' : 'false')
}

async function mountHeader(): Promise<DevtoolsHeader> {
  const header = await mount<DevtoolsHeader>(HEADER)
  await settle(header)
  return header
}

async function toggleTheme(header: DevtoolsHeader): Promise<void> {
  shadow(header, THEME_BUTTON)?.click()
  await settle(header)
}

/** A theme change made in ANOTHER window: the value is already stored by the
 *  time the event arrives, which is what the header re-reads. */
async function themeChangedElsewhere(
  header: DevtoolsHeader,
  key: string,
  theme: 'dark' | 'light'
): Promise<void> {
  store(theme)
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      newValue: theme === 'dark' ? 'true' : 'false'
    })
  )
  await settle(header)
}

/**
 * How the header really hides an icon. It marks the two `show` and `hidden`, but
 * `show` matches no rule in `core.css` or the Tailwind build — only `hidden` does
 * anything, so the shown icon is simply the one that is NOT hidden. Read off the
 * class rather than the computed style because two specs below inspect the header
 * AFTER removing it, and a disconnected element reports no display at all; the
 * spec 'hides the icon it is not offering in layout' ties the class to what the
 * user sees.
 */
const isHidden = (icon: Element): boolean => icon.classList.contains('hidden')

/** The two icons, or a throw: a header that rendered neither must not read as
 *  one of them. */
function themeIcons(header: DevtoolsHeader): [Element, Element] {
  const sun = shadow(header, SUN)
  const moon = shadow(header, MOON)
  if (!sun || !moon) {
    throw new Error(`the header rendered no ${sun ? 'moon' : 'sun'} icon`)
  }
  return [sun, moon]
}

/**
 * Which theme the header is OFFERING to switch to. Throws rather than guessing
 * when an icon is missing or when both/neither are on offer — reading "moon" off
 * an absent sun is how a header that drew no icons at all would report light, and
 * every theme assertion in this file goes through here.
 */
function shownIcon(header: DevtoolsHeader): 'sun' | 'moon' {
  const [sun, moon] = themeIcons(header)
  const shown = [sun, moon].filter((icon) => !isHidden(icon))
  if (shown.length !== 1) {
    throw new Error(`expected one icon on offer, found ${shown.length}`)
  }
  return shown[0] === sun ? 'sun' : 'moon'
}

let osThemeEmulated = false

/**
 * Really flip the OS-level setting: `prefers-color-scheme` is overridden through
 * CDP, so every live MediaQueryList in the page fires `change` exactly as it does
 * when the user switches their system theme. Nothing lighter reaches the
 * subscription under test — `matchMedia()` hands out a NEW MediaQueryList per
 * call, so a stubbed one is invisible to whoever already subscribed.
 */
async function osThemeBecomes(theme: 'dark' | 'light'): Promise<void> {
  await browser.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme }]
  })
  osThemeEmulated = true
  // The drive itself, asserted: without it the tests below would pass on any
  // header, since nothing would have changed.
  expect(osPrefersDark()).toBe(theme === 'dark')
}

/** Resolves once the page has delivered the flip to a media query of this spec's
 *  own — which is proof that the one `controller/theme` subscribed to, notified in
 *  the same page task, has been called too. The CDP command returns as soon as
 *  `matches` reports the new value, BEFORE that delivery, so awaiting the command
 *  alone makes these specs race the listener under test. */
function osThemeDelivered(): Promise<void> {
  return new Promise((resolve) => {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => resolve(), { once: true })
  })
}

/** Flip the OS setting and wait for the page to hand it to its listeners. Only
 *  for a flip that really changes the value — an unchanged setting fires no
 *  `change`, so this would wait for an event that never comes. */
async function osThemeFlipsTo(theme: 'dark' | 'light'): Promise<void> {
  const delivered = osThemeDelivered()
  await osThemeBecomes(theme)
  await delivered
}

/** Hand the setting back to the machine running the suite. */
async function restoreOsTheme(): Promise<void> {
  if (!osThemeEmulated) {
    return
  }
  osThemeEmulated = false
  await browser.sendCommand('Emulation.setEmulatedMedia', { features: [] })
}

/** Nothing carries over: the next test picks its own theme, and the document and
 *  the OS setting are left as the runner found them. */
afterEach(async () => {
  document.body.classList.remove('dark')
  localStorage.removeItem(DARK_MODE_KEY)
  await restoreOsTheme()
})

describe('wdio-devtools-header', () => {
  describe('title bar', () => {
    it('renders the product logo and name', async () => {
      const header = await mountHeader()

      expect(shadowAll(header, LOGO)).toHaveLength(1)
      expect(text(shadow(header, TITLE))).toBe('WebdriverIO Devtools')
    })

    it('renders a single theme control', async () => {
      const header = await mountHeader()

      expect(shadowAll(header, THEME_BUTTON)).toHaveLength(1)
    })

    it('renders both theme icons but shows only one', async () => {
      const header = await mountHeader()

      expect(shadowAll(header, MOON)).toHaveLength(1)
      expect(shadowAll(header, SUN)).toHaveLength(1)
      expect(themeIcons(header).filter(isHidden)).toHaveLength(1)
    })

    it('hides the icon it is not offering in layout, not only in name', async () => {
      store('light')
      const header = await mountHeader()

      // Ties `hidden` to what the user sees, once, so the rest of this file can
      // read the class: `hidden` really is `display:none`, while `show` — the
      // other class the header sets — matches no rule and hides nothing.
      const [sun, moon] = themeIcons(header)
      expect(getComputedStyle(sun).display).toBe('none')
      expect(getComputedStyle(moon).display).not.toBe('none')
      expect(shownIcon(header)).toBe('moon')
    })
  })

  describe('theme on mount', () => {
    it('opens in the stored dark theme', async () => {
      store('dark')

      const header = await mountHeader()

      expect(shownIcon(header)).toBe('sun')
      expect(isDark()).toBe(true)
    })

    it('opens in the stored light theme', async () => {
      store('light')

      const header = await mountHeader()

      expect(shownIcon(header)).toBe('moon')
      expect(isDark()).toBe(false)
    })

    it('reads the stored theme per header, not once per module load', async () => {
      store('light')
      const light = await mountHeader()

      store('dark')
      const dark = await mountHeader()

      // Both were constructed from the same loaded module, so a snapshot taken at
      // import time would render these two the same way.
      expect(shownIcon(light)).toBe('moon')
      expect(shownIcon(dark)).toBe('sun')
    })

    it('follows the OS setting until the user has picked a theme', async () => {
      localStorage.removeItem(DARK_MODE_KEY)

      const header = await mountHeader()

      expect(shownIcon(header)).toBe(osPrefersDark() ? 'sun' : 'moon')
      expect(isDark()).toBe(osPrefersDark())
    })

    it('clears a stale dark document when the stored theme says light', async () => {
      document.body.classList.add('dark')
      store('light')

      const header = await mountHeader()

      // The header applies the theme it renders, so its icon and the document
      // cannot disagree.
      expect(shownIcon(header)).toBe('moon')
      expect(isDark()).toBe(false)
    })
  })

  describe('theme toggle', () => {
    it('offers the moon while the dashboard is light', async () => {
      store('light')
      const header = await mountHeader()

      expect(shownIcon(header)).toBe('moon')
      expect(isDark()).toBe(false)
    })

    it('darkens the dashboard when the control is clicked', async () => {
      store('light')
      const header = await mountHeader()

      await toggleTheme(header)

      expect(isDark()).toBe(true)
      expect(shownIcon(header)).toBe('sun')
    })

    it('lightens it again on the next click', async () => {
      store('light')
      const header = await mountHeader()

      await toggleTheme(header)
      await toggleTheme(header)

      expect(isDark()).toBe(false)
      expect(shownIcon(header)).toBe('moon')
    })

    it('stores the choice so the next visit opens in the same theme', async () => {
      store('light')
      const header = await mountHeader()
      expect(storedTheme()).toBe('false')

      await toggleTheme(header)
      expect(storedTheme()).toBe('true')

      await toggleTheme(header)
      expect(storedTheme()).toBe('false')
    })

    it('themes the document rather than only itself', async () => {
      store('light')
      const header = await mountHeader()

      await toggleTheme(header)

      // The dark class lands on <body>, which is what the app's Tailwind
      // `dark:` variants and the popout windows read.
      expect(isDark()).toBe(true)
      expect(header.classList.contains('dark')).toBe(false)
    })
  })

  describe('theme changed in another window', () => {
    it('switches to the theme the other window stored', async () => {
      store('light')
      const header = await mountHeader()

      await themeChangedElsewhere(header, DARK_MODE_KEY, 'dark')

      expect(shownIcon(header)).toBe('sun')
    })

    it('switches back when the other window returns to light', async () => {
      store('dark')
      const header = await mountHeader()

      await themeChangedElsewhere(header, DARK_MODE_KEY, 'light')

      expect(shownIcon(header)).toBe('moon')
    })

    it('ignores a change to an unrelated stored setting', async () => {
      store('light')
      const header = await mountHeader()

      // The theme now says dark, but this event is not about the theme — so the
      // header must not re-read it.
      await themeChangedElsewhere(header, 'sidebarWidth', 'dark')

      expect(shownIcon(header)).toBe('moon')
    })

    it('stops listening once it leaves the DOM', async () => {
      store('light')
      const header = await mountHeader()

      header.remove()
      await themeChangedElsewhere(header, DARK_MODE_KEY, 'dark')

      expect(shownIcon(header)).toBe('moon')
    })
  })

  describe('OS theme flipped', () => {
    it('follows the OS while the user has not picked a theme', async () => {
      localStorage.removeItem(DARK_MODE_KEY)
      await osThemeBecomes('light')
      const header = await mountHeader()
      expect(shownIcon(header)).toBe('moon')

      await osThemeFlipsTo('dark')
      await settle(header)

      // Regression: only the document used to follow the OS (the shell listens
      // for it), so a mounted header kept offering to switch to the theme the
      // dashboard was already showing.
      expect(shownIcon(header)).toBe('sun')
      expect(isDark()).toBe(true)
    })

    it('follows it back to light again', async () => {
      localStorage.removeItem(DARK_MODE_KEY)
      await osThemeBecomes('dark')
      const header = await mountHeader()
      expect(shownIcon(header)).toBe('sun')

      await osThemeFlipsTo('light')
      await settle(header)

      expect(shownIcon(header)).toBe('moon')
      expect(isDark()).toBe(false)
    })

    it('ignores the OS once the user has picked a theme', async () => {
      await osThemeBecomes('light')
      store('light')
      const header = await mountHeader()

      await osThemeFlipsTo('dark')
      await settle(header)

      // The stored choice is the answer while it exists — the OS is only the
      // fallback, so this flip must not undo what the user picked. The flip was
      // delivered before this ran, so an unchanged icon is a decision, not a race.
      expect(shownIcon(header)).toBe('moon')
      expect(isDark()).toBe(false)
    })

    it('stops following the OS once it leaves the DOM', async () => {
      localStorage.removeItem(DARK_MODE_KEY)
      await osThemeBecomes('light')
      const header = await mountHeader()

      header.remove()
      await osThemeFlipsTo('dark')
      await settle(header)

      expect(shownIcon(header)).toBe('moon')
    })
  })

  describe('theme preference', () => {
    it('prefers the theme the user stored', () => {
      store('dark')
      expect(prefersDarkMode()).toBe(true)

      store('light')
      expect(prefersDarkMode()).toBe(false)
    })

    it('falls back to the OS setting while nothing is stored', () => {
      localStorage.removeItem(DARK_MODE_KEY)

      expect(prefersDarkMode()).toBe(osPrefersDark())
    })

    it('reads anything other than the stored `true` as light', () => {
      localStorage.setItem(DARK_MODE_KEY, 'yes')

      expect(prefersDarkMode()).toBe(false)
    })
  })
})
