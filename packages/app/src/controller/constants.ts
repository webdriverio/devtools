export const CACHE_ID = 'wdio-trace-cache'
export const SIDEBAR_MIN_WIDTH = 250
export const DARK_MODE_KEY = 'darkMode'
export const MIN_WORKBENCH_HEIGHT = Math.min(300, window.innerHeight * 0.3)
export const MIN_METATAB_WIDTH = 260
export const RERENDER_TIMEOUT = 10
export const SIDEBAR_DEFAULT_WIDTH = 350
export const ACTIONS_DEFAULT_WIDTH = 360
export const BROWSER_HEIGHT_RATIO = 1.4 / 2.4
export const TRACE_TIMELINE_MIN_HEIGHT = 80
export const TRACE_TIMELINE_DEFAULT_HEIGHT = 100
/** Player-mode dock sizing — the browser pane takes the remaining space. */
export const PLAYER_DOCK_MIN_HEIGHT = 140
export const PLAYER_DOCK_DEFAULT_HEIGHT = 220
/** Controls bar on the tab-header line in player mode (matches h-10 headers). */
export const PLAYER_CONTROLS_HEIGHT = 40
/** Fixed app-header height (see header.ts / app.ts `h-[calc(100%-40px)]`). */
export const HEADER_HEIGHT = 40
export const LOG_ICONS: Record<string, string> = {
  log: '›',
  info: 'ⓘ',
  warn: '⚠',
  error: '✕'
}

/** Console-tab badge per log source: short label + style class. */
export const CONSOLE_SOURCE_BADGE: Record<
  NonNullable<ConsoleLogs['source']>,
  { label: string; class: string }
> = {
  test: { label: 'TEST', class: 'b-test' },
  terminal: { label: 'RUNNER', class: 'b-runner' },
  browser: { label: 'PAGE', class: 'b-browser' }
}
