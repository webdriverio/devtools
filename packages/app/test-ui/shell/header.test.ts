import { DARK_MODE_KEY } from '@/controller/constants.js'
import { prefersDarkMode } from '@components/header.js'
import type { DevtoolsHeader } from '@components/header.js'

import { mount, settle } from '../support/mount.js'
import { shadow, shadowAll, text } from '../support/queries.js'

const HEADER = 'wdio-devtools-header'
const LOGO = 'icon-custom-logo'
const TITLE = 'h1'
const THEME_BUTTON = 'nav button'
const MOON = 'icon-mdi-moon-waning-crescent'
const SUN = 'icon-mdi-white-balance-sunny'
const SHOWN = '.show'
const HIDDEN = '.hidden'

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

const shownIcon = (header: DevtoolsHeader) =>
  shadow(header, SUN)?.className === 'show' ? 'sun' : 'moon'

/** Nothing carries over: the next test picks its own theme, and the document is
 *  left as the runner found it. */
afterEach(() => {
  document.body.classList.remove('dark')
  localStorage.removeItem(DARK_MODE_KEY)
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
      expect(shadowAll(header, SHOWN)).toHaveLength(1)
      expect(shadowAll(header, HIDDEN)).toHaveLength(1)
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

      expect(shadow(header, MOON)?.className).toBe('show')
      expect(shadow(header, SUN)?.className).toBe('hidden')
      expect(isDark()).toBe(false)
    })

    it('darkens the dashboard when the control is clicked', async () => {
      store('light')
      const header = await mountHeader()

      await toggleTheme(header)

      expect(isDark()).toBe(true)
      expect(shadow(header, SUN)?.className).toBe('show')
      expect(shadow(header, MOON)?.className).toBe('hidden')
    })

    it('lightens it again on the next click', async () => {
      store('light')
      const header = await mountHeader()

      await toggleTheme(header)
      await toggleTheme(header)

      expect(isDark()).toBe(false)
      expect(shadow(header, MOON)?.className).toBe('show')
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
