import { DARK_MODE_KEY } from './constants.js'

/**
 * The app's theme: what it resolves to, where it is stored, and every source that
 * can change it. The header's icon, the `<body>` class the Tailwind `dark:`
 * variants read, and a popout window that renders no header all resolve it here,
 * so they cannot disagree about it.
 */

const OS_DARK_QUERY = '(prefers-color-scheme: dark)'

export type ThemeListener = (dark: boolean) => void

const listeners = new Set<ThemeListener>()

/** Kept rather than re-created per call: every `matchMedia()` returns its OWN
 *  MediaQueryList, so a second one is a second subscription that nothing else
 *  can see — including a spec driving the OS setting. */
let osQuery: MediaQueryList | undefined

const osDarkQuery = (): MediaQueryList =>
  (osQuery ??= window.matchMedia(OS_DARK_QUERY))

/** The theme to render: the choice the user stored, else the OS setting. */
export function prefersDarkMode(): boolean {
  const stored = localStorage.getItem(DARK_MODE_KEY)
  return stored === null ? osDarkQuery().matches : stored === 'true'
}

/** Remember the user's choice, so the next visit opens in the same theme. */
export function storeDarkMode(dark: boolean): void {
  localStorage.setItem(DARK_MODE_KEY, dark ? 'true' : 'false')
}

/** Theme the document. The class lands on `<body>` because that is what the
 *  Tailwind `dark:` variants and the popout windows read. */
export function applyDarkMode(dark: boolean): void {
  document.body.classList.toggle('dark', dark)
}

/** One resolved answer per change, handed to every subscriber, so no two of them
 *  re-derive it and land on different values. */
function announceTheme(): void {
  const dark = prefersDarkMode()
  for (const listener of listeners) {
    listener(dark)
  }
}

// `storage` fires only for writes made in ANOTHER window — a popout, a second
// dashboard tab.
const onStorage = (event: StorageEvent): void => {
  if (event.key === DARK_MODE_KEY) {
    announceTheme()
  }
}

// Installed once and left in place: the sources belong to the document, not to
// whichever component happened to subscribe first.
let watching = false

function watchThemeSources(): void {
  if (watching) {
    return
  }
  watching = true
  window.addEventListener('storage', onStorage)
  osDarkQuery().addEventListener('change', announceTheme)
}

/**
 * Follow the theme the app should render. Both sources are here — the user
 * storing a choice in another window, and the OS flipping while no choice is
 * stored — because a subscriber watching only one of them ends up disagreeing
 * with one watching the other. Returns the unsubscribe.
 */
export function onThemeChange(listener: ThemeListener): () => void {
  watchThemeSources()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
