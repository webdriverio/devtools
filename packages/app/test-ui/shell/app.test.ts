import type { TracePlayerData } from '@wdio/devtools-shared'

import '@/app.js'
import type { WebdriverIODevtoolsApplication } from '@/app.js'
import {
  CACHE_ID,
  DARK_MODE_KEY,
  SIDEBAR_DEFAULT_WIDTH
} from '@/controller/constants.js'
import { POPOUT_QUERY } from '@components/workbench/compare/constants.js'
import type { DevtoolsHeader } from '@components/header.js'
import type { DevtoolsSidebar } from '@components/sidebar.js'
import type { DevtoolsSidebarExplorer } from '@components/sidebar/explorer.js'
import type { ExplorerTestEntry } from '@components/sidebar/test-suite.js'
import type { DevtoolsShortcuts } from '@components/shortcuts-overlay.js'
import type { DevtoolsWorkbench } from '@components/workbench.js'
import type { DevtoolsCompare } from '@components/workbench/compare.js'

import { mount, settle } from '../support/mount.js'
import { shadow, shadowAll, text, texts } from '../support/queries.js'
import {
  installFakeBackend,
  loginCommands,
  loginRun,
  openClientSocket,
  standaloneMetadata,
  testrunnerMetadata,
  tracePlayerData,
  waitFor
} from './fixtures.js'
import type { FakeBackend } from './fixtures.js'

const APP = 'wdio-devtools'
const HEADER = 'wdio-devtools-header'
const START = 'wdio-devtools-start'
const SIDEBAR = 'wdio-devtools-sidebar'
const EXPLORER = 'wdio-devtools-sidebar-explorer'
const WORKBENCH = 'wdio-devtools-workbench'
const SHORTCUTS = 'wdio-devtools-shortcuts'
const COMPARE = 'wdio-devtools-compare'
const MAIN = 'section[data-resizer-window]'
const SIDEBAR_SLIDER =
  'section[data-resizer-window] > button[data-draggable-id]'
const ROW = 'wdio-test-entry'
const ROW_LABEL = 'wdio-test-entry > label'
const BACKDROP = '.backdrop'
const PLAYER_CONTROLS = 'wdio-devtools-trace-player-controls'
const EMPTY_COMPARISON = '.empty-state'

/** A `[scope, data]` pair as it arrives on the dashboard's client socket. */
type Frame = [string, unknown]

const METADATA: Frame = ['metadata', testrunnerMetadata]
const STANDALONE: Frame = ['metadata', standaloneMetadata]
const SUITES: Frame = ['suites', loginRun.frame]
const COMMANDS: Frame = ['commands', loginCommands]

let backend: FakeBackend | undefined

afterEach(() => {
  backend?.restore()
  backend = undefined
  // The player path caches the trace it loaded, and the sidebar remembers its
  // width — both would otherwise decide what the next mount renders.
  localStorage.removeItem(CACHE_ID)
  localStorage.removeItem('sidebarWidth')
})

async function mountApp(options: { trace?: TracePlayerData } = {}) {
  backend = installFakeBackend(options)
  return mount<WebdriverIODevtoolsApplication>(APP)
}

/** The live dashboard: the app boots, finds no trace to play, and subscribes.
 *  Frames are pushed after `open` because that is when the app starts reading
 *  the socket. */
async function liveApp(...frames: Frame[]) {
  const app = await mountApp()
  const socket = await openClientSocket(backend!)
  await settle(app)
  for (const [scope, data] of frames) {
    socket.send(scope, data)
  }
  await settle(app)
  await settleTree(app)
  return { app, socket }
}

async function playerApp(trace = tracePlayerData()) {
  const app = await mountApp({ trace })
  await waitFor(() => app.dataManager.playerMode, 'the served trace to load')
  await settle(app)
  return app
}

function workbench(app: Element): DevtoolsWorkbench {
  const el = shadow<DevtoolsWorkbench>(app, WORKBENCH)
  if (!el) {
    throw new Error('the app rendered no workbench')
  }
  return el
}

function explorerOf(app: Element): DevtoolsSidebarExplorer {
  const sidebar = shadow<DevtoolsSidebar>(app, SIDEBAR)
  if (!sidebar) {
    throw new Error('the app rendered no sidebar')
  }
  const explorer = shadow<DevtoolsSidebarExplorer>(sidebar, EXPLORER)
  if (!explorer) {
    throw new Error('the sidebar rendered no explorer')
  }
  return explorer
}

/** Each element down the tree renders in its own update cycle. */
async function settleTree(app: WebdriverIODevtoolsApplication): Promise<void> {
  const sidebar = shadow<DevtoolsSidebar>(app, SIDEBAR)
  if (!sidebar) {
    return
  }
  await settle(sidebar)
  const explorer = explorerOf(app)
  await settle(explorer)
  for (const row of shadowAll<ExplorerTestEntry>(explorer, ROW)) {
    await settle(row)
  }
}

const treeLabels = (app: Element) => texts(explorerOf(app), ROW_LABEL)

const rowState = (app: Element, uid: string) =>
  shadow(explorerOf(app), `${ROW}[uid="${uid}"]`)?.getAttribute('state')

function overlay(app: Element): DevtoolsShortcuts {
  const el = shadow<DevtoolsShortcuts>(app, SHORTCUTS)
  if (!el) {
    throw new Error('the app rendered no shortcuts overlay')
  }
  return el
}

const press = (key: string) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))

/** `show-command` is the app's own output for keyboard navigation. Typed with the
 *  event map's own `CommandEventProps`, so a detail missing a field the contract
 *  declares is a spec failure rather than a silently absent property. */
async function showCommand(
  app: WebdriverIODevtoolsApplication,
  act: () => void
): Promise<CommandEventProps[]> {
  const received: CommandEventProps[] = []
  const listener = (event: Event) =>
    received.push((event as CustomEvent<CommandEventProps>).detail)
  window.addEventListener('show-command', listener)
  try {
    act()
    await settle(app)
  } finally {
    window.removeEventListener('show-command', listener)
  }
  return received
}

describe('wdio-devtools', () => {
  describe('boot', () => {
    it('renders the header and the onboarding screen until a session connects', async () => {
      const app = await mountApp()
      await waitFor(
        () => backend!.sockets.length > 0,
        'the client subscription'
      )
      await settle(app)

      expect(shadowAll(app, HEADER)).toHaveLength(1)
      expect(shadowAll(app, START)).toHaveLength(1)
      expect(shadowAll(app, MAIN)).toHaveLength(0)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(0)
    })

    it('subscribes to the dashboard client socket', async () => {
      const app = await mountApp()
      await waitFor(
        () => backend!.sockets.length > 0,
        'the client subscription'
      )
      await settle(app)

      expect(backend!.sockets).toHaveLength(1)
      expect(backend!.sockets[0].url).toContain('/client')
    })

    it('closes its socket when it leaves the DOM', async () => {
      const app = await mountApp()
      const socket = await openClientSocket(backend!)
      await settle(app)

      app.remove()

      expect(socket.closed).toBe(true)
    })

    it('swaps the onboarding screen for the workbench once connected', async () => {
      const { app } = await liveApp()

      expect(shadowAll(app, START)).toHaveLength(0)
      expect(shadowAll(app, MAIN)).toHaveLength(1)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(1)
      expect(shadowAll(app, HEADER)).toHaveLength(1)
    })
  })

  describe('live testrunner session', () => {
    it('renders the test tree beside the workbench', async () => {
      const { app } = await liveApp(METADATA)

      expect(shadowAll(app, SIDEBAR)).toHaveLength(1)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(1)
    })

    it('sizes the tree with its resizable default width', async () => {
      const { app } = await liveApp(METADATA)

      expect(shadow<HTMLElement>(app, SIDEBAR)?.style.flexBasis).toBe(
        `${SIDEBAR_DEFAULT_WIDTH}px`
      )
      expect(shadowAll(app, SIDEBAR_SLIDER)).toHaveLength(1)
    })

    it('renders no test tree before the session reports what captured it', async () => {
      const { app } = await liveApp()

      expect(shadowAll(app, SIDEBAR)).toHaveLength(0)
      expect(shadowAll(app, SIDEBAR_SLIDER)).toHaveLength(0)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(1)
    })

    it('renders no test tree for a standalone capture, which has no runner', async () => {
      const { app } = await liveApp(STANDALONE)

      expect(shadowAll(app, SIDEBAR)).toHaveLength(0)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(1)
    })

    it('keeps the workbench out of player layout', async () => {
      const { app } = await liveApp(METADATA)

      expect(workbench(app).playerMode).toBe(false)
      expect(shadowAll(workbench(app), PLAYER_CONTROLS)).toHaveLength(0)
    })

    it('hands the reported suites down to the test tree', async () => {
      const { app } = await liveApp(METADATA, SUITES)

      expect(treeLabels(app)).toEqual(loginRun.rowLabels)
    })

    it('ignores a frame that carries no data', async () => {
      const { app, socket } = await liveApp(METADATA, SUITES)

      socket.send('suites', null)
      await settle(app)
      await settleTree(app)

      expect(treeLabels(app)).toEqual(loginRun.rowLabels)
    })
  })

  describe('clearing execution data', () => {
    it('marks the whole tree running again when a rerun clears it', async () => {
      const { app } = await liveApp(METADATA, SUITES)

      app.dispatchEvent(
        new CustomEvent('clear-execution-data', {
          detail: { uid: '*', entryType: 'suite' }
        })
      )
      await settle(app)
      await settleTree(app)

      // A full rerun drops the previous run's leaf results, so the suite row is
      // all that is left — and it is running.
      expect(treeLabels(app)).toEqual([loginRun.suite.title])
      expect(rowState(app, loginRun.suite.uid)).toBe('running')
    })

    it('marks only the named test running when one test reruns', async () => {
      const { app } = await liveApp(METADATA, SUITES)

      app.dispatchEvent(
        new CustomEvent('clear-execution-data', {
          detail: { uid: loginRun.passing.uid, entryType: 'test' }
        })
      )
      await settle(app)
      await settleTree(app)

      expect(treeLabels(app)).toEqual(loginRun.rowLabels)
      expect(rowState(app, loginRun.passing.uid)).toBe('running')
      expect(rowState(app, loginRun.failing.uid)).toBe('failed')
    })
  })

  describe('trace player', () => {
    it('plays the trace the backend serves instead of subscribing', async () => {
      const app = await playerApp()

      expect(backend!.sockets).toHaveLength(0)
      expect(shadowAll(app, START)).toHaveLength(0)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(1)
    })

    it('puts the workbench in player layout', async () => {
      const app = await playerApp()
      const panel = workbench(app)
      await settle(panel)

      expect(panel.playerMode).toBe(true)
      expect(shadowAll(panel, PLAYER_CONTROLS)).toHaveLength(1)
    })

    it('renders no test tree, even for a testrunner-captured trace', async () => {
      const app = await playerApp()

      // The trace carries testrunner metadata and a suite registry; the player
      // still drops the tree because it has no run/rerun affordances.
      expect(app.dataManager.traceType).toBe(testrunnerMetadata.type)
      expect(shadowAll(app, SIDEBAR)).toHaveLength(0)
    })

    it('tells the shortcuts overlay the playback keys are live', async () => {
      const app = await playerApp()

      expect(overlay(app).playerMode).toBe(true)
    })
  })

  describe('shortcuts overlay', () => {
    it('mounts the overlay closed', async () => {
      const { app } = await liveApp(METADATA)

      expect(overlay(app).open).toBe(false)
      expect(shadowAll(overlay(app), BACKDROP)).toHaveLength(0)
    })

    it('opens the overlay on ?', async () => {
      const { app } = await liveApp(METADATA)

      press('?')
      await settle(app)
      await settle(overlay(app))

      expect(overlay(app).open).toBe(true)
      expect(shadowAll(overlay(app), BACKDROP)).toHaveLength(1)
    })

    it('closes it again on a second ?', async () => {
      const { app } = await liveApp(METADATA)

      press('?')
      await settle(app)
      press('?')
      await settle(app)
      await settle(overlay(app))

      expect(overlay(app).open).toBe(false)
      expect(shadowAll(overlay(app), BACKDROP)).toHaveLength(0)
    })

    it('closes it when the overlay asks to close', async () => {
      const { app } = await liveApp(METADATA)
      press('?')
      await settle(app)

      overlay(app).dispatchEvent(new CustomEvent('close'))
      await settle(app)
      await settle(overlay(app))

      expect(overlay(app).open).toBe(false)
    })

    it('tells the overlay the playback keys are dead in the live dashboard', async () => {
      const { app } = await liveApp(METADATA)

      expect(overlay(app).playerMode).toBe(false)
    })
  })

  describe('keyboard command navigation', () => {
    it('surfaces the first command on the first step forward', async () => {
      const { app } = await liveApp(METADATA, COMMANDS)

      const received = await showCommand(app, () => press('ArrowRight'))

      expect(received).toHaveLength(1)
      expect(received[0].command.command).toBe(loginCommands[0].command)
      expect(received[0].elapsedTime).toBe(0)
    })

    it('steps to the next command, timed from the first', async () => {
      const { app } = await liveApp(METADATA, COMMANDS)

      press('ArrowRight')
      await settle(app)
      const received = await showCommand(app, () => press('ArrowRight'))

      expect(received[0].command.command).toBe(loginCommands[1].command)
      expect(received[0].elapsedTime).toBe(
        loginCommands[1].timestamp - loginCommands[0].timestamp
      )
    })

    it('stops at the last command', async () => {
      const { app } = await liveApp(METADATA, COMMANDS)

      press('ArrowRight')
      press('ArrowRight')
      await settle(app)
      const received = await showCommand(app, () => press('ArrowRight'))

      expect(received[0].command.command).toBe(loginCommands[1].command)
    })

    it('jumps to the last command on End and back on Home', async () => {
      const { app } = await liveApp(METADATA, COMMANDS)

      const last = await showCommand(app, () => press('End'))
      const first = await showCommand(app, () => press('Home'))

      expect(last[0].command.command).toBe(loginCommands[1].command)
      expect(first[0].command.command).toBe(loginCommands[0].command)
      expect(first[0].elapsedTime).toBe(0)
    })

    it('walks the commands in captured order even when they arrive reversed', async () => {
      const { app } = await liveApp(METADATA, [
        'commands',
        [loginCommands[1], loginCommands[0]]
      ])

      const received = await showCommand(app, () => press('ArrowRight'))

      expect(received[0].command.command).toBe(loginCommands[0].command)
    })

    it('surfaces nothing while no command has been captured', async () => {
      const { app } = await liveApp(METADATA)

      const received = await showCommand(app, () => press('ArrowRight'))

      expect(received).toHaveLength(0)
    })

    it('leaves the keys to the timeline in the trace player', async () => {
      const app = await playerApp()

      const received = await showCommand(app, () => press('ArrowRight'))

      // The app steps only in the live dashboard. In the player the timeline
      // answers the same key, stepping on from the action it announced at mount —
      // the app's own first step would surface the FIRST command instead, so a
      // second emitter would show up here.
      expect(received).toHaveLength(1)
      expect(received[0].command.command).toBe(loginCommands[1].command)
      // Both emitters time an action from the first command, so the Logs panel
      // badges the same offset whichever one answered the key.
      expect(received[0].elapsedTime).toBe(
        loginCommands[1].timestamp - loginCommands[0].timestamp
      )
    })
  })

  // The sidebar row announces a selection as a bubbling, composed
  // `app-test-select`; only the shell can turn that into the selected-test
  // context the Compare tab and panel key on. Without this the selection moved
  // only on a preserve or a popout, so clicking a different test left Compare
  // showing the previous test's baseline.
  describe('test selection', () => {
    it('publishes a selected row as the selected test', async () => {
      const { app } = await liveApp(METADATA, SUITES)
      // The sidebar only appears once the metadata frame has been ingested,
      // which can land a tick after `liveApp` settles — without waiting on it
      // the row query races the mount and fails intermittently.
      await waitFor(
        () => Boolean(shadow(app, SIDEBAR)),
        'the sidebar to render'
      )
      await settleTree(app)

      // The row sits two shadow roots down (app → sidebar → explorer), so it
      // is reached through the explorer; the event's own `composed` flag is
      // what carries it back out to the shell.
      const row = shadow<HTMLElement>(
        explorerOf(app),
        `wdio-test-entry[uid="${loginRun.passing.uid}"]`
      )
      if (!row) {
        throw new Error('the explorer rendered no row for the passing test')
      }
      row.dispatchEvent(
        new CustomEvent('app-test-select', {
          detail: loginRun.passing.uid,
          bubbles: true,
          composed: true
        })
      )
      await settle(app)

      expect(app.dataManager.selectedTestUidContextProvider.value).toBe(
        loginRun.passing.uid
      )
    })

    it('stops listening once it leaves the page', async () => {
      const { app } = await liveApp(METADATA, SUITES)
      app.remove()

      app.dispatchEvent(
        new CustomEvent('app-test-select', {
          detail: loginRun.passing.uid,
          bubbles: true,
          composed: true
        })
      )

      expect(
        app.dataManager.selectedTestUidContextProvider.value
      ).toBeUndefined()
    })
  })

  describe('theme', () => {
    const SUN = 'icon-mdi-white-balance-sunny'
    let osThemeEmulated = false

    /** Really flip the OS-level setting: `prefers-color-scheme` is overridden
     *  through CDP, so the page's live MediaQueryLists fire `change` the way they
     *  do when the user switches their system theme. */
    async function osThemeBecomes(theme: 'dark' | 'light'): Promise<void> {
      await browser.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: theme }]
      })
      osThemeEmulated = true
      expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(
        theme === 'dark'
      )
    }

    /** Flip it and wait for the page to hand the change to its listeners: the CDP
     *  command returns as soon as `matches` reports the new value, which is before
     *  the media query notifies anyone. Waiting on a listener of this spec's own is
     *  what keeps the assertions below from racing the shell and the header. */
    async function osThemeFlipsTo(theme: 'dark' | 'light'): Promise<void> {
      const delivered = new Promise<void>((resolve) => {
        window
          .matchMedia('(prefers-color-scheme: dark)')
          .addEventListener('change', () => resolve(), { once: true })
      })
      await osThemeBecomes(theme)
      await delivered
    }

    function header(app: Element): DevtoolsHeader {
      const el = shadow<DevtoolsHeader>(app, HEADER)
      if (!el) {
        throw new Error('the app rendered no header')
      }
      return el
    }

    /** The theme the header's control renders: the sun offers a way out of dark. */
    const headerTheme = (app: Element) =>
      shadow(header(app), SUN)?.className === 'show' ? 'dark' : 'light'

    const documentTheme = () =>
      document.body.classList.contains('dark') ? 'dark' : 'light'

    afterEach(async () => {
      localStorage.removeItem(DARK_MODE_KEY)
      document.body.classList.remove('dark')
      if (osThemeEmulated) {
        osThemeEmulated = false
        await browser.sendCommand('Emulation.setEmulatedMedia', {
          features: []
        })
      }
    })

    it('opens the dashboard in the stored dark theme', async () => {
      localStorage.setItem(DARK_MODE_KEY, 'true')

      const { app } = await liveApp(METADATA)

      // The stored theme is read when the shell renders, not when its module was
      // loaded — this value was written long after that.
      expect(shadowAll(app, HEADER)).toHaveLength(1)
      expect(document.body.classList.contains('dark')).toBe(true)
    })

    it('leaves the dashboard light when the stored theme says light', async () => {
      localStorage.setItem(DARK_MODE_KEY, 'false')
      document.body.classList.add('dark')

      await liveApp(METADATA)

      expect(document.body.classList.contains('dark')).toBe(false)
    })

    it('keeps the document and the header in step when the OS theme flips', async () => {
      localStorage.removeItem(DARK_MODE_KEY)
      await osThemeBecomes('light')
      const { app } = await liveApp(METADATA)
      expect([documentTheme(), headerTheme(app)]).toEqual(['light', 'light'])

      await osThemeFlipsTo('dark')
      await settle(header(app))

      // Regression: the shell followed the OS on its own, so the document went
      // dark while the header it renders kept showing the light-mode icon.
      expect([documentTheme(), headerTheme(app)]).toEqual(['dark', 'dark'])
    })
  })

  describe('compare popout', () => {
    const search = window.location.search

    afterEach(() => {
      history.replaceState(null, '', `${window.location.pathname}${search}`)
    })

    it('renders only the comparison when opened as a popout', async () => {
      const params = new URLSearchParams(search)
      params.set(POPOUT_QUERY.viewKey, POPOUT_QUERY.viewValue)
      params.set(POPOUT_QUERY.uidKey, loginRun.failing.uid)
      history.replaceState(null, '', `?${params.toString()}`)

      const { app } = await liveApp(METADATA, SUITES)

      expect(shadowAll(app, COMPARE)).toHaveLength(1)
      expect(shadowAll(app, HEADER)).toHaveLength(0)
      expect(shadowAll(app, SIDEBAR)).toHaveLength(0)
      expect(shadowAll(app, WORKBENCH)).toHaveLength(0)
    })

    it('selects the test the parent window was viewing', async () => {
      const params = new URLSearchParams(search)
      params.set(POPOUT_QUERY.viewKey, POPOUT_QUERY.viewValue)
      params.set(POPOUT_QUERY.uidKey, loginRun.failing.uid)
      history.replaceState(null, '', `?${params.toString()}`)

      const { app } = await liveApp(METADATA, SUITES)
      const compare = shadow<DevtoolsCompare>(app, COMPARE)
      await settle(compare!)

      expect(app.dataManager.selectedTestUidContextProvider.value).toBe(
        loginRun.failing.uid
      )
      // Nothing was preserved in this session, so the comparison says so.
      expect(text(shadow(compare!, EMPTY_COMPARISON))).toContain(
        'No baseline preserved.'
      )
    })
  })
})
