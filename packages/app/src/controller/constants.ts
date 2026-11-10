import type { LogSource } from '@wdio/devtools-shared'

import type { TraceOpenPhase } from './trace-parse-protocol.js'

export const CACHE_ID = 'wdio-trace-cache'
/** Built with `--mode hosted`: the static trace player, with no backend. */
export const HOSTED_PLAYER = import.meta.env.MODE === 'hosted'
export const TRACE_OPEN_EVENT = 'app-trace-open'
export const TRACE_RUN_SELECT_EVENT = 'app-trace-run-select'
export const TRACE_FILE_ACCEPT = '.zip,application/zip'
/** The player's dock announces it has built its tabs, then each tab opened since (label as detail). */
export const DOCK_TABS_READY_EVENT = 'app-dock-tabs-ready'
export const DOCK_TAB_CHANGE_EVENT = 'app-dock-tab-change'
/** Opens a dock tab; `linked` matches the label without case and leaves the remembered tab alone. */
export const OPEN_DOCK_TAB_EVENT = 'open-dock-tab'
/** Largest zip `?trace=` downloads; the tab holds the zip, but reads its entries one at a time as they are shown. */
export const TRACE_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024
/** Bytes of a shown trace's images and bodies kept read; past this the least recently shown are dropped and read again when needed. */
export const TRACE_ENTRY_CACHE_BYTES = 64 * 1024 * 1024
/** How long a `?trace=` download may receive nothing before it is stopped. */
export const TRACE_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
export const TRACE_OPEN_PHASE_LABEL: Record<TraceOpenPhase, string> = {
  downloading: 'Downloading the trace…',
  reading: 'Reading the file…',
  unpacking: 'Unpacking the archive…',
  building: 'Building the timeline…'
}
export const SIDEBAR_MIN_WIDTH = 250
export const DARK_MODE_KEY = 'darkMode'
/**
 * Smallest useful workbench pane, for the window AS IT IS NOW. A function
 * rather than a constant: evaluated at module import it froze at whatever
 * window happened to be open then, and — because it is also the pane's
 * `minPosition` — pinned the pane there for the life of the page. Loaded in a
 * 413px-tall window it is 124px, which is what a trace then rendered into on a
 * 2560px screen.
 */
export function minWorkbenchHeight(): number {
  return Math.min(300, window.innerHeight * 0.3)
}
export const MIN_METATAB_WIDTH = 260
/** Narrowest useful device column — below this a phone frame is unreadable. */
export const DEVICE_PANE_MIN_WIDTH = 180
/**
 * Slack added to a device column's width so its frame is bound by HEIGHT.
 * The frame spends some of the column on its own header, padding and border,
 * so a column sized to `height x ratio` leaves the capture less height than
 * that and it becomes width-bound instead — measured at ~180px of dead space
 * above AND below. The error is asymmetric: a column a few px too wide costs a
 * sliver of side backdrop, one too narrow costs that whole gap, so this biases
 * wide on purpose.
 */
export const DEVICE_PANE_CHROME_ALLOWANCE = 48
/** Most of the window a device column may take, so the dock stays usable. */
export const DEVICE_PANE_MAX_WIDTH_RATIO = 0.6
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
/** Width factor on the player snapshot's aspect box — trims width, keeps height. */
export const PLAYER_SNAPSHOT_WIDTH_RATIO = 0.9
/** Backdrop behind the browser chrome — shared with the snapshot component styles. */
export const BROWSER_BACKDROP_GRADIENT =
  'radial-gradient(120% 120% at 50% 0%, var(--vscode-editorWidget-background), var(--vscode-editor-background))'
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
  LogSource,
  { label: string; class: string }
> = {
  test: { label: 'TEST', class: 'b-test' },
  terminal: { label: 'RUNNER', class: 'b-runner' },
  browser: { label: 'PAGE', class: 'b-browser' }
}
