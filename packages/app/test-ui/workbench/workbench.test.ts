// The workbench is the dashboard's right-hand column: a browser pane, the
// actions sidebar, and the dock. It owns no data of its own — every panel it
// mounts reads context — so what it can get wrong is *which* panels exist, and
// the Compare tab is the one that comes and goes. That conditional is the join
// between DataManager publishing a baseline for the selected test and the
// compare panel rendering it; neither end's spec covers it.

import { collectErrors } from '@components/workbench/errors/collect.js'
import { pairSteps } from '@components/workbench/compare/compareUtils.js'
import type { DevtoolsTabs } from '@components/tabs.js'

import { shadow, shadowAll, text, texts } from '../support/queries.js'
import {
  DOCK_CACHE_ID,
  OTHER_TEST_UID,
  SELECTED_TEST_UID,
  SIDEBAR_CACHE_ID,
  UNPRESERVED_TEST_UID,
  baselineMap,
  consoleLogs,
  dockTabs,
  erroringCommand,
  failingSuites,
  liveCommands,
  mountWorkbench,
  openPanelTags,
  openTabLabels,
  networkRequests,
  preservedAttempt,
  preservedCommands,
  tabLabels
} from './workbench-fixtures.js'
import type { WorkbenchHarness } from './workbench-fixtures.js'

const BROWSER = 'wdio-devtools-browser'
const TIMELINE = 'wdio-devtools-trace-timeline'
const PLAYER_CONTROLS = 'wdio-devtools-trace-player-controls'
const COMPARE_PANEL = 'wdio-devtools-compare'
const TAB_BUTTON = 'nav button'
const TAB_LABEL = 'nav button > span:first-child'
const BADGE = '.tab-badge'
const DANGER_BADGE = '.tab-badge--danger'
const ACTIVE_BUTTON = 'nav button.tab-btn--active'
const SIDEBAR_SECTION = 'section[data-sidebar]'
const RESTORE_SIDEBAR = 'button:has(icon-mdi-arrow-collapse-right)'
const COLLAPSE_SIDEBAR = 'button:has(icon-mdi-arrow-collapse-left)'
const COLLAPSE_DOCK = 'button:has(icon-mdi-arrow-collapse-down)'
const RESTORE_DOCK = 'button:has(icon-mdi-arrow-collapse-up)'
const STEP_ROW = '.step-row'
const EMPTY_STATE = '.empty-state'

/** The dock in live mode. Player mode appends A11y + Transcript, and a baseline
 *  preserved for the selected test appends Compare — both asserted below. */
const LIVE_DOCK = ['Source', 'Log', 'Console', 'Network', 'Errors']

const SIDEBAR_TABS = ['Actions', 'Metadata']

/** Rows the compare panel owes for the fixture pair, computed with the same
 *  pairing function the panel calls — a workbench that wired the panel to the
 *  wrong command stream renders a different number. */
const PAIRED_ROWS = pairSteps(preservedCommands(), liveCommands).length

function button(bar: DevtoolsTabs, label: string): HTMLButtonElement {
  const found = shadowAll<HTMLButtonElement>(bar, TAB_BUTTON).find(
    (candidate) => text(candidate).startsWith(label)
  )
  if (!found) {
    throw new Error(`no tab button rendered for "${label}"`)
  }
  return found
}

async function clickTab(
  harness: WorkbenchHarness,
  bar: DevtoolsTabs,
  label: string
): Promise<void> {
  button(bar, label).click()
  await harness.settleTabs()
}

async function clickInWorkbench(
  harness: WorkbenchHarness,
  selector: string
): Promise<void> {
  const target = shadow<HTMLButtonElement>(harness.workbench, selector)
  if (!target) {
    throw new Error(`the workbench rendered no ${selector}`)
  }
  target.click()
  await harness.settleTabs()
}

const badgeFor = (bar: DevtoolsTabs, label: string): string | null => {
  const found = shadowAll(bar, TAB_BUTTON).find((candidate) =>
    text(candidate).startsWith(label)
  )
  return found ? (shadow(found, BADGE)?.textContent ?? null) : null
}

const openTab = (label?: string) =>
  window.dispatchEvent(new CustomEvent('open-dock-tab', { detail: { label } }))

/** The baseline the fixtures preserve, keyed to whichever test asked for it. */
const preservedFor = (uid: string) =>
  baselineMap([uid, preservedAttempt({ testUid: uid })])

/** A drag controller hunts for its slider once more 50ms after it is built, so
 *  a handle the current mode never renders complains just after the mount. */
const DRAG_RETRY_SETTLE = 150

/** Every `console.warn` raised by a mount, up to the drag handles' retry. */
async function warningsWhileMounting(
  mountOne: () => Promise<unknown>
): Promise<string[]> {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    await mountOne()
    await new Promise<void>((resolve) => setTimeout(resolve, DRAG_RETRY_SETTLE))
  } finally {
    console.warn = original
  }
  return warnings
}

describe('wdio-devtools-workbench', () => {
  describe('default render', () => {
    it('renders the browser pane and both tab bars', async () => {
      const { workbench, dock, sidebar } = await mountWorkbench()

      expect(shadowAll(workbench, BROWSER)).toHaveLength(1)
      expect(dock.getAttribute('cacheId')).toBe(DOCK_CACHE_ID)
      expect(sidebar.getAttribute('cacheId')).toBe(SIDEBAR_CACHE_ID)
    })

    it('docks the live panels in order', async () => {
      const { dock } = await mountWorkbench()

      expect(tabLabels(dock)).toEqual(LIVE_DOCK)
      expect(texts(dock, TAB_LABEL)).toEqual(LIVE_DOCK)
    })

    it('puts the matching panel behind every dock label', async () => {
      const { dock } = await mountWorkbench()

      // A label wired to the wrong panel — or to none — is what this catches.
      expect(
        dockTabs(dock).map((tab) =>
          (tab.firstElementChild?.tagName ?? '').toLowerCase()
        )
      ).toEqual([
        'wdio-devtools-source',
        'wdio-devtools-logs',
        'wdio-devtools-console-logs',
        'wdio-devtools-network',
        'wdio-devtools-errors'
      ])
    })

    it('offers the actions and metadata tabs beside the browser', async () => {
      const { sidebar } = await mountWorkbench()

      expect(tabLabels(sidebar)).toEqual(SIDEBAR_TABS)
      expect(openTabLabels(sidebar)).toEqual(['Actions'])
    })

    it('opens the first dock tab', async () => {
      const { dock } = await mountWorkbench()

      expect(openTabLabels(dock)).toEqual(['Source'])
      expect(text(shadow(dock, ACTIVE_BUTTON))).toBe('Source')
    })

    it('renders no player chrome in live mode', async () => {
      const { workbench } = await mountWorkbench()

      expect(shadowAll(workbench, TIMELINE)).toHaveLength(0)
      expect(shadowAll(workbench, PLAYER_CONTROLS)).toHaveLength(0)
    })

    it('leaves the counted tabs unbadged until something is captured', async () => {
      const { dock } = await mountWorkbench()

      expect(shadowAll(dock, BADGE)).toHaveLength(0)
    })
  })

  describe('player mode', () => {
    it('adds the timeline strip and the playback controls', async () => {
      const { workbench } = await mountWorkbench({}, { playerMode: true })

      expect(shadowAll(workbench, TIMELINE)).toHaveLength(1)
      expect(shadowAll(workbench, PLAYER_CONTROLS)).toHaveLength(1)
    })

    it('docks the trace-only panels after the live ones', async () => {
      const { dock } = await mountWorkbench({}, { playerMode: true })

      expect(tabLabels(dock)).toEqual([...LIVE_DOCK, 'A11y', 'Transcript'])
    })

    it('keeps the browser pane and the sidebar', async () => {
      const { workbench, sidebar } = await mountWorkbench(
        {},
        { playerMode: true }
      )

      expect(shadowAll(workbench, BROWSER)).toHaveLength(1)
      expect(tabLabels(sidebar)).toEqual(SIDEBAR_TABS)
    })
  })

  describe('switching dock tabs', () => {
    it('shows the panel of the tab that is clicked', async () => {
      const harness = await mountWorkbench()

      await clickTab(harness, harness.dock, 'Network')

      expect(openTabLabels(harness.dock)).toEqual(['Network'])
      expect(text(shadow(harness.dock, ACTIVE_BUTTON))).toContain('Network')
    })

    it('opens the dock tab a component asks for', async () => {
      // The A11y overlay jumps the dock to its own tab this way.
      const harness = await mountWorkbench({}, { playerMode: true })

      openTab('A11y')
      await harness.settleTabs()

      expect(openTabLabels(harness.dock)).toEqual(['A11y'])
    })

    it('ignores a request for a tab the dock does not have', async () => {
      const harness = await mountWorkbench()

      openTab('A11y')
      await harness.settleTabs()

      expect(openTabLabels(harness.dock)).toEqual(['Source'])
    })

    it('leaves the sidebar tab alone when the dock tab changes', async () => {
      const harness = await mountWorkbench()

      await clickTab(harness, harness.dock, 'Errors')

      expect(openTabLabels(harness.sidebar)).toEqual(['Actions'])
    })

    it('leaves the dock tab alone when the sidebar tab changes', async () => {
      const harness = await mountWorkbench()

      await clickTab(harness, harness.sidebar, 'Metadata')

      expect(openTabLabels(harness.sidebar)).toEqual(['Metadata'])
      expect(openTabLabels(harness.dock)).toEqual(['Source'])
    })

    it('remembers each bar under its own cache id', async () => {
      const harness = await mountWorkbench()

      await clickTab(harness, harness.dock, 'Console')
      await clickTab(harness, harness.sidebar, 'Metadata')

      expect(localStorage.getItem(DOCK_CACHE_ID)).toBe('Console')
      expect(localStorage.getItem(SIDEBAR_CACHE_ID)).toBe('Metadata')
    })

    it('reopens the dock tab it remembered', async () => {
      localStorage.setItem(DOCK_CACHE_ID, 'Errors')

      const { dock } = await mountWorkbench()

      expect(openTabLabels(dock)).toEqual(['Errors'])
    })
  })

  describe('dock counts', () => {
    it('counts the console entries on the Console tab', async () => {
      const logs = consoleLogs()
      const { dock } = await mountWorkbench({ consoleLogs: logs })

      expect(badgeFor(dock, 'Console')).toBe(String(logs.length))
    })

    it('counts the network requests on the Network tab', async () => {
      const requests = networkRequests()
      const { dock } = await mountWorkbench({ networkRequests: requests })

      expect(badgeFor(dock, 'Network')).toBe(String(requests.length))
    })

    it('counts the collected errors on the Errors tab', async () => {
      const commands = [...liveCommands, erroringCommand]
      const suites = failingSuites()
      // Derived through the same collector the workbench calls: a count taken
      // from the raw command list instead would miss the de-duplication.
      const expected = collectErrors(commands, suites)
      const { dock } = await mountWorkbench({ commands, suites })

      expect(expected.length).toBeGreaterThan(0)
      expect(badgeFor(dock, 'Errors')).toBe(String(expected.length))
    })

    it('tints the error count and nothing else', async () => {
      const { dock } = await mountWorkbench({
        commands: [erroringCommand],
        suites: failingSuites()
      })

      expect(shadowAll(dock, DANGER_BADGE)).toHaveLength(1)
      expect(
        shadow(dock, DANGER_BADGE)?.previousElementSibling?.textContent
      ).toBe('Errors')
    })

    it('leaves the Errors tab unbadged for a clean run', async () => {
      const { dock } = await mountWorkbench({ commands: liveCommands })

      expect(badgeFor(dock, 'Errors')).toBe(null)
    })
  })

  describe('collapsing the panes', () => {
    it('hides the dock and offers a way back', async () => {
      const harness = await mountWorkbench()

      await clickInWorkbench(harness, COLLAPSE_DOCK)

      expect([...harness.dock.classList]).toContain('hidden')
      expect(shadowAll(harness.workbench, RESTORE_DOCK)).toHaveLength(1)
      expect(localStorage.getItem('toolbar')).toBe('true')
    })

    it('starts with the dock collapsed when it was left that way', async () => {
      localStorage.setItem('toolbar', 'true')

      const { dock, workbench } = await mountWorkbench()

      expect([...dock.classList]).toContain('hidden')
      expect(shadowAll(workbench, RESTORE_DOCK)).toHaveLength(1)
    })

    it('collapses the actions sidebar to nothing', async () => {
      const harness = await mountWorkbench()

      await clickInWorkbench(harness, COLLAPSE_SIDEBAR)

      expect(
        shadow(harness.workbench, SIDEBAR_SECTION)?.getAttribute('style')
      ).toContain('width:0')
      expect(shadowAll(harness.workbench, RESTORE_SIDEBAR)).toHaveLength(1)
      expect(localStorage.getItem('workbenchSidebar')).toBe('true')
    })

    it('brings the sidebar back', async () => {
      const harness = await mountWorkbench()
      await clickInWorkbench(harness, COLLAPSE_SIDEBAR)

      await clickInWorkbench(harness, RESTORE_SIDEBAR)

      expect(
        shadow(harness.workbench, SIDEBAR_SECTION)?.getAttribute('style')
      ).not.toContain('width:0')
      expect(localStorage.getItem('workbenchSidebar')).toBe('false')
    })
  })

  describe('the resize handles', () => {
    // Each mode renders only its own handles, so the ones it leaves out must
    // stay quiet rather than reporting their missing slider on every mount.
    it('mounts live mode without complaining about the player handles', async () => {
      const warnings = await warningsWhileMounting(() =>
        mountWorkbench({ commands: liveCommands })
      )

      expect(warnings).toEqual([])
    })

    it('mounts player mode without complaining about the live handle', async () => {
      const warnings = await warningsWhileMounting(() =>
        mountWorkbench({ commands: liveCommands }, { playerMode: true })
      )

      expect(warnings).toEqual([])
    })
  })

  describe('the Compare tab', () => {
    it('offers no Compare tab before a baseline is preserved', async () => {
      const { dock, workbench } = await mountWorkbench({
        commands: liveCommands,
        selectedTestUid: SELECTED_TEST_UID
      })

      expect(tabLabels(dock)).toEqual(LIVE_DOCK)
      expect(shadowAll(workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it('offers no Compare tab while the baseline map is empty', async () => {
      const { dock } = await mountWorkbench({
        baselines: baselineMap(),
        selectedTestUid: SELECTED_TEST_UID
      })

      expect(tabLabels(dock)).toEqual(LIVE_DOCK)
    })

    it('adds the Compare tab once a baseline is preserved', async () => {
      const { dock, workbench } = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      expect(tabLabels(dock)).toEqual([...LIVE_DOCK, 'Compare'])
      expect(shadowAll(workbench, COMPARE_PANEL)).toHaveLength(1)
    })

    it('offers no Compare tab until a test is selected', async () => {
      const { dock, workbench } = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        commands: liveCommands
      })

      expect(tabLabels(dock)).toEqual(LIVE_DOCK)
      expect(shadowAll(workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it('leaves the Compare tab uncounted', async () => {
      const { dock } = await mountWorkbench({
        baselines: baselineMap(
          [SELECTED_TEST_UID, preservedAttempt()],
          [OTHER_TEST_UID, preservedAttempt({ testUid: OTHER_TEST_UID })]
        ),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      // The tab holds the selected test's comparison and no other, so counting
      // every preserved baseline would contradict what it opens onto.
      expect(tabLabels(dock)).toContain('Compare')
      expect(badgeFor(dock, 'Compare')).toBe(null)
    })

    it('shows the comparison when the tab is clicked', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      await clickTab(harness, harness.dock, 'Compare')
      const panel = shadow(harness.workbench, COMPARE_PANEL)

      expect(openTabLabels(harness.dock)).toEqual(['Compare'])
      // The panel got both sides through the workbench's own contexts, so it
      // pairs the preserved run against the live one instead of prompting.
      expect(shadowAll(panel!, EMPTY_STATE)).toHaveLength(0)
      expect(shadowAll(panel!, STEP_ROW)).toHaveLength(PAIRED_ROWS)
    })

    it('adds the Compare tab when the baseline arrives after the mount', async () => {
      const harness = await mountWorkbench({
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)

      await harness.publishBaselines(preservedFor(SELECTED_TEST_UID))

      expect(tabLabels(harness.dock)).toEqual([...LIVE_DOCK, 'Compare'])
      expect(texts(harness.dock, TAB_LABEL)).toContain('Compare')
    })

    it('drops the Compare tab when the baseline is cleared', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      expect(tabLabels(harness.dock)).toContain('Compare')

      await harness.publishBaselines(baselineMap())

      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)
      expect(texts(harness.dock, TAB_LABEL)).toEqual(LIVE_DOCK)
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it("keeps the tab when another test's baseline is cleared", async () => {
      const harness = await mountWorkbench({
        baselines: baselineMap(
          [SELECTED_TEST_UID, preservedAttempt()],
          [OTHER_TEST_UID, preservedAttempt({ testUid: OTHER_TEST_UID })]
        ),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      await harness.publishBaselines(preservedFor(SELECTED_TEST_UID))

      expect(tabLabels(harness.dock)).toContain('Compare')
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(1)
    })

    // What the panel renders is the SELECTED test's baseline, so a baseline held
    // for any other test is nothing the tab can show — it would open onto the
    // panel's own "no baseline preserved" prompt.
    it('drops the Compare tab when the baseline belongs to another test', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(OTHER_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it("drops the tab when the selected test's own baseline is cleared", async () => {
      // The panel's Clear button drops exactly this one; another test keeping
      // its baseline must not leave a tab with nothing to compare.
      const harness = await mountWorkbench({
        baselines: baselineMap(
          [SELECTED_TEST_UID, preservedAttempt()],
          [OTHER_TEST_UID, preservedAttempt({ testUid: OTHER_TEST_UID })]
        ),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      await harness.publishBaselines(preservedFor(OTHER_TEST_UID))

      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it('adds Compare after the trace-only tabs in player mode', async () => {
      const { dock } = await mountWorkbench(
        {
          baselines: preservedFor(SELECTED_TEST_UID),
          selectedTestUid: SELECTED_TEST_UID,
          commands: liveCommands
        },
        { playerMode: true }
      )

      expect(tabLabels(dock)).toEqual([
        ...LIVE_DOCK,
        'A11y',
        'Transcript',
        'Compare'
      ])
    })

    // Dropping the tab that is OPEN has to hand the dock back to a tab it still
    // renders, or the dock shows no panel at all until the user clicks one.
    it('falls back to the first dock tab when the open Compare tab is dropped', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      await clickTab(harness, harness.dock, 'Compare')

      await harness.publishBaselines(baselineMap())

      expect(openTabLabels(harness.dock)).toEqual(['Source'])
      expect(text(shadow(harness.dock, ACTIVE_BUTTON))).toBe('Source')
    })

    it('falls back to the first dock tab when the remembered one is gone', async () => {
      localStorage.setItem(DOCK_CACHE_ID, 'Compare')

      const { dock } = await mountWorkbench({
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      expect(tabLabels(dock)).toEqual(LIVE_DOCK)
      expect(openTabLabels(dock)).toEqual(['Source'])
      expect(text(shadow(dock, ACTIVE_BUTTON))).toBe('Source')
    })
  })

  // The other half of the same join: the baseline map holds still and the
  // SELECTION moves. Preserving auto-selects the preserved test, so this is the
  // step right after it — and the panel only ever renders the selected test's
  // baseline, so the tab has to follow the selection, not just the map.
  // (Today only the preserve auto-select and the popout hand-off publish this
  // context; a sidebar row click updates the explorer's own highlight only.)
  describe('the Compare tab following the selection', () => {
    it('drops the tab when the selection moves to a test with no baseline', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      expect(tabLabels(harness.dock)).toEqual([...LIVE_DOCK, 'Compare'])

      await harness.publishSelectedTestUid(OTHER_TEST_UID)

      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)
      expect(texts(harness.dock, TAB_LABEL)).toEqual(LIVE_DOCK)
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(0)
    })

    it('brings the tab back when the preserved test is selected again', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      await harness.publishSelectedTestUid(OTHER_TEST_UID)

      await harness.publishSelectedTestUid(SELECTED_TEST_UID)
      await clickTab(harness, harness.dock, 'Compare')
      const panel = shadow(harness.workbench, COMPARE_PANEL)

      expect(tabLabels(harness.dock)).toEqual([...LIVE_DOCK, 'Compare'])
      // The returning tab opens onto the real pairing, not the panel's own
      // "No baseline preserved." prompt.
      expect(shadowAll(panel!, EMPTY_STATE)).toHaveLength(0)
      expect(shadowAll(panel!, STEP_ROW)).toHaveLength(PAIRED_ROWS)
    })

    it('offers no tab for a test no baseline was ever preserved for', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        commands: liveCommands
      })

      await harness.publishSelectedTestUid(UNPRESERVED_TEST_UID)

      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)
      expect(shadowAll(harness.workbench, COMPARE_PANEL)).toHaveLength(0)
      expect(openPanelTags(harness.dock)).toEqual(['wdio-devtools-source'])
    })

    it('waits for the other test to be selected before offering its baseline', async () => {
      const harness = await mountWorkbench({
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })

      await harness.publishBaselines(preservedFor(OTHER_TEST_UID))
      expect(tabLabels(harness.dock)).toEqual(LIVE_DOCK)

      await harness.publishSelectedTestUid(OTHER_TEST_UID)
      await clickTab(harness, harness.dock, 'Compare')

      expect(tabLabels(harness.dock)).toEqual([...LIVE_DOCK, 'Compare'])
      expect(
        shadowAll(shadow(harness.workbench, COMPARE_PANEL)!, STEP_ROW)
      ).toHaveLength(PAIRED_ROWS)
    })

    // Same hand-back as clearing the baseline under the open tab: a selection
    // that unmounts the OPEN Compare tab must leave a panel on screen.
    it('falls back to the first dock tab when the selection drops the open Compare tab', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      await clickTab(harness, harness.dock, 'Compare')
      expect(openTabLabels(harness.dock)).toEqual(['Compare'])

      await harness.publishSelectedTestUid(OTHER_TEST_UID)

      expect(openTabLabels(harness.dock)).toEqual(['Source'])
      expect(openPanelTags(harness.dock)).toEqual(['wdio-devtools-source'])
      expect(text(shadow(harness.dock, ACTIVE_BUTTON))).toBe('Source')
    })

    it('leaves the fallback tab open when the Compare tab returns', async () => {
      const harness = await mountWorkbench({
        baselines: preservedFor(SELECTED_TEST_UID),
        selectedTestUid: SELECTED_TEST_UID,
        commands: liveCommands
      })
      await clickTab(harness, harness.dock, 'Compare')
      await harness.publishSelectedTestUid(OTHER_TEST_UID)

      await harness.publishSelectedTestUid(SELECTED_TEST_UID)

      // The tab is offered again, but re-selecting a test is not a request to
      // jump panels — the dock stays where the fallback left it.
      expect(tabLabels(harness.dock)).toEqual([...LIVE_DOCK, 'Compare'])
      expect(openTabLabels(harness.dock)).toEqual(['Source'])
    })
  })
})
