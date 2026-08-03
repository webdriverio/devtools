import '@components/sidebar/test-suite.js'
import type { ExplorerTestEntry } from '@components/sidebar/test-suite.js'
import type { TestRunDetail } from '@components/sidebar/types.js'

import { capture } from '../../support/events.js'
import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import {
  CALL_SOURCE,
  entryProps,
  FEATURE_FILE,
  gherkinRun,
  mixedStateRun,
  neverRanTest,
  profileSuite,
  rowProps,
  type TestEntryProps
} from '../fixtures.js'

const TAG = 'wdio-test-entry'
const LABEL_SPAN = 'section.row > span'
const CHEVRON_BUTTON = 'section.row > button'
const CHEVRON = 'icon-mdi-menu-down'
const LABEL_SLOT = 'slot[name="label"]'
const CHILDREN_SLOT = 'slot[name="children"]'
const TOOLBAR_BUTTON = 'nav.row-actions button'
const RUN_BUTTON = 'nav.row-actions button:has(icon-mdi-play)'
const STOP_BUTTON = 'nav.row-actions button:has(icon-mdi-stop)'
const RERUN_BUTTON = 'nav.row-actions button:has(icon-mdi-bug-play)'
const RUNNING_DOT = '.run-dot'
const PASSED_ICON = 'icon-mdi-check'
const FAILED_ICON = 'icon-mdi-close'
const SKIPPED_ICON = 'icon-mdi-debug-step-over'
const NOT_RUN_ICON = 'icon-mdi-circle-outline'
const COLLAPSE_ALL_ICON = 'icon-mdi-collapse-all'
const EXPAND_ALL_ICON = 'icon-mdi-expand-all'

const STEP_FALLBACK_REASON =
  'Single-step execution is controlled by its scenario.'
const CUCUMBER_REASON =
  'Single-test execution is not supported by this framework.'

/** The row renders its group in a second section next to the label row; the
 *  slot is the only stable handle on it. */
const childrenSection = (row: Element) =>
  shadow(row, CHILDREN_SLOT)?.parentElement

/** Row props come from `rowProps(fragment)` — the real `getTestEntry` over a
 *  fragment — so the label the explorer would slot is already in them; a spec
 *  only names one when it is asserting the projection itself. */
async function mountRow(
  props: TestEntryProps = {},
  label?: string
): Promise<ExplorerTestEntry> {
  const resolved = entryProps(props)
  const row = await mount<ExplorerTestEntry>(TAG, resolved)
  const title = document.createElement('label')
  title.slot = 'label'
  title.textContent = label ?? resolved.labelText ?? ''
  row.append(title)
  await settle(row)
  return row
}

describe('wdio-test-entry', () => {
  describe('state icon', () => {
    it('shows a check for a passing test', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      expect(shadowAll(row, PASSED_ICON)).toHaveLength(1)
      expect(
        shadow(row, PASSED_ICON)?.classList.contains('text-chartsGreen')
      ).toBe(true)
    })

    it('shows a cross for a failing test', async () => {
      const row = await mountRow(rowProps(mixedStateRun.failing))

      expect(shadowAll(row, FAILED_ICON)).toHaveLength(1)
      expect(
        shadow(row, FAILED_ICON)?.classList.contains('text-chartsRed')
      ).toBe(true)
    })

    it('shows a step-over arrow for a skipped test', async () => {
      const row = await mountRow(rowProps(mixedStateRun.skipped))

      expect(shadowAll(row, SKIPPED_ICON)).toHaveLength(1)
      expect(
        shadow(row, SKIPPED_ICON)?.classList.contains('text-chartsYellow')
      ).toBe(true)
    })

    it('shows a pulsing dot instead of an icon while a test runs', async () => {
      const row = await mountRow(rowProps(mixedStateRun.running))

      expect(shadowAll(row, RUNNING_DOT)).toHaveLength(1)
      expect(shadowAll(row, PASSED_ICON)).toHaveLength(0)
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(0)
    })

    it('shows an empty circle for a test that is only pending', async () => {
      // A leaf with no state and no end stamp is the one fragment shape that
      // derives to 'pending' — a *reported* pending leaf is a run in progress
      // and derives to 'running'.
      const row = await mountRow(rowProps(neverRanTest))

      expect(row.state).toBe('pending')
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
      expect(
        shadow(row, NOT_RUN_ICON)?.classList.contains('text-disabledForeground')
      ).toBe(true)
    })

    it('shows an empty circle for a test with no state at all', async () => {
      // Hand-set: `computeEntryState` always returns a status, so a stateless
      // row is only reachable when something other than the explorer mounts it.
      const row = await mountRow({ state: undefined })

      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
    })

    it('shows an empty circle for a state it does not recognise', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      // Hand-set through the attribute: no fragment derives to a state outside
      // TestStatus, and the attribute is how the explorer feeds state — so this
      // keeps an off-contract value out of the typed property.
      row.setAttribute('state', 'aborted')
      await settle(row)

      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
      expect(shadowAll(row, PASSED_ICON)).toHaveLength(0)
    })

    it('swaps the icon when the state changes', async () => {
      const row = await mountRow(rowProps(mixedStateRun.running))

      row.state = rowProps(mixedStateRun.failing).state
      await settle(row)

      expect(shadowAll(row, RUNNING_DOT)).toHaveLength(0)
      expect(shadowAll(row, FAILED_ICON)).toHaveLength(1)
    })

    it('leaves the state icon off a root row', async () => {
      // `root` is hand-set: it marks the row's position in the tree, which is
      // the explorer's own knowledge and not part of any fragment.
      const row = await mountRow(
        rowProps(mixedStateRun.failing, { root: true })
      )

      expect(row.hasAttribute('root')).toBe(true)
      expect(shadowAll(row, FAILED_ICON)).toHaveLength(0)
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(0)
    })
  })

  describe('title', () => {
    it('renders the title projected into the label slot', async () => {
      const row = await mountRow(rowProps(mixedStateRun.failing))

      const slot = shadow<HTMLSlotElement>(row, LABEL_SLOT)
      expect(slot?.assignedElements().map((el) => text(el))).toEqual([
        mixedStateRun.failing.title
      ])
    })
  })

  describe('reveal', () => {
    it('keeps a name on one line until the row is clicked', async () => {
      const row = await mountRow(rowProps(mixedStateRun.failing))

      expect(row.hasAttribute('revealed')).toBe(false)
    })

    // The explorer owns which row is reflowed, so one click can fold another
    // row; a row that reflowed itself would leave both open.
    it('does not reflow itself on click', async () => {
      const row = await mountRow(rowProps(mixedStateRun.failing))

      shadow(row, LABEL_SPAN)?.click()
      await settle(row)

      expect(row.hasAttribute('revealed')).toBe(false)
    })

    it('reflows its name when the explorer reveals it', async () => {
      const row = await mountRow({
        ...rowProps(mixedStateRun.failing),
        revealed: true
      })

      expect(row.hasAttribute('revealed')).toBe(true)
    })

    // The tree auto-selects the running test, so a selected row that reflowed
    // would grow a row nobody clicked — and mid-run, a different one each time.
    it('does not reflow a row the tree merely selected', async () => {
      const row = await mountRow({
        ...rowProps(mixedStateRun.running),
        selected: true
      })

      expect(row.hasAttribute('revealed')).toBe(false)
    })
  })

  describe('selection', () => {
    it('announces its uid on app-test-select when the row is clicked', async () => {
      const row = await mountRow(rowProps(mixedStateRun.failing))

      const received = capture<string>(row, 'app-test-select', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toBe(mixedStateRun.failing.uid)
      // Composed so it survives the explorer's shadow boundary, where the
      // explorer listens for it.
      expect(received[0]?.bubbles).toBe(true)
      expect(received[0]?.composed).toBe(true)
    })

    it('stays silent when the row has no uid', async () => {
      // Hand-set: `getTestEntry` always carries the fragment's uid through.
      const row = await mountRow({ uid: undefined })

      const received = capture<string>(row, 'app-test-select', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(0)
    })

    it('asks the source view on window to highlight its call site', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      const received = capture<string>(window, 'app-source-highlight', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toBe(CALL_SOURCE)
    })

    it('leaves the source view alone when the row has no call site', async () => {
      // The running fragment reports no call site, so the derived row has none.
      const row = await mountRow(rowProps(mixedStateRun.running))

      const received = capture<string>(window, 'app-source-highlight', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(0)
    })

    it('reflects the selected flag so the row can be styled', async () => {
      // Hand-set: selection is explorer state (clicked row, or the running row
      // it auto-selects), not something a fragment reports.
      const row = await mountRow({ selected: true })

      expect(row.hasAttribute('selected')).toBe(true)
    })

    it('leaves an unselected row without the selected attribute', async () => {
      const row = await mountRow()

      expect(row.hasAttribute('selected')).toBe(false)
    })
  })

  describe('row actions', () => {
    it('offers a run button on a row that is not running', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(1)
      expect(shadow(row, RUN_BUTTON)?.getAttribute('title')).toBe(
        'Run this entry'
      )
      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(0)
    })

    it('replaces the run button with a stop button while the row runs', async () => {
      const row = await mountRow(rowProps(mixedStateRun.running))

      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
      expect(shadowAll(row, RERUN_BUTTON)).toHaveLength(0)
    })

    it('offers a preserve-and-rerun button only after a failure', async () => {
      const failed = await mountRow(rowProps(mixedStateRun.failing))
      const passed = await mountRow(rowProps(mixedStateRun.passing))

      expect(shadowAll(failed, RERUN_BUTTON)).toHaveLength(1)
      expect(shadowAll(passed, RERUN_BUTTON)).toHaveLength(0)
    })

    it('emits app-test-run carrying the row identity', async () => {
      // The Gherkin scenario is the only fixture carrying feature coordinates,
      // and it derives to 'failed' from its one failing step — so the run
      // control is present and every identity field below is derived.
      const scenario = gherkinRun.scenario
      const row = await mountRow(rowProps(scenario))

      const received = capture<TestRunDetail>(row, 'app-test-run', () =>
        shadow(row, RUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({
        uid: scenario.uid,
        entryType: 'suite',
        specFile: FEATURE_FILE,
        fullTitle: scenario.title,
        label: scenario.title,
        callSource: scenario.callSource,
        featureFile: FEATURE_FILE,
        featureLine: scenario.featureLine,
        suiteType: scenario.type
      })
      expect(received[0]?.composed).toBe(true)
    })

    it('emits app-test-stop for the running row without the feature fields', async () => {
      const step = gherkinRun.runningStep
      const row = await mountRow(rowProps(step))

      const received = capture<TestRunDetail>(row, 'app-test-stop', () =>
        shadow(row, STOP_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({
        uid: step.uid,
        entryType: 'test',
        specFile: FEATURE_FILE,
        fullTitle: step.fullTitle,
        label: step.title
      })
      // The row does carry them — the stop detail deliberately leaves them out.
      expect(row.featureFile).toBe(FEATURE_FILE)
      expect(received[0]?.detail.featureFile).toBeUndefined()
      expect(received[0]?.detail.featureLine).toBeUndefined()
    })

    it('emits app-test-preserve-rerun for the failed row', async () => {
      const scenario = gherkinRun.scenario
      const row = await mountRow(rowProps(scenario))

      const received = capture<TestRunDetail>(
        row,
        'app-test-preserve-rerun',
        () => shadow(row, RERUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.uid).toBe(scenario.uid)
      expect(received[0]?.detail.suiteType).toBe(scenario.type)
      expect(received[0]?.composed).toBe(true)
    })

    it('disables the run button and explains why when running is not supported', async () => {
      // Hand-set: `runDisabled` comes from the runner's capabilities in the
      // metadata context, which no suite or test fragment carries.
      const row = await mountRow({
        runDisabled: true,
        runDisabledReason: CUCUMBER_REASON
      })

      const button = shadow<HTMLButtonElement>(row, RUN_BUTTON)
      expect(button?.disabled).toBe(true)
      expect(button?.getAttribute('title')).toBe(CUCUMBER_REASON)
      expect(button?.classList.contains('cursor-not-allowed')).toBe(true)
    })

    it('explains a disabled row generically when no reason was supplied', async () => {
      // Hand-set for the same reason as above.
      const row = await mountRow({ runDisabled: true })

      expect(shadow(row, RUN_BUTTON)?.getAttribute('title')).toBe(
        STEP_FALLBACK_REASON
      )
    })

    it('refuses to emit a run request from a disabled row', async () => {
      const row = await mountRow({ runDisabled: true })

      // dispatchEvent, not click(): click() is a no-op on a disabled button, so
      // it would pass without the guard inside the handler being exercised.
      const received = capture<TestRunDetail>(row, 'app-test-run', () =>
        shadow(row, RUN_BUTTON)?.dispatchEvent(new MouseEvent('click'))
      )

      expect(received).toHaveLength(0)
    })

    it('keeps the stop button on a running row the runner cannot start', async () => {
      // `runDisabled` is a *launch* capability. A run already in flight is
      // stoppable whatever the framework is able to start, so the stop control
      // survives it — otherwise a Nightwatch run could never be stopped.
      const row = await mountRow(
        rowProps(mixedStateRun.running, { runDisabled: true })
      )

      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
    })

    it('emits app-test-stop from a running row the runner cannot start', async () => {
      const step = mixedStateRun.running
      const row = await mountRow(rowProps(step, { runDisabled: true }))

      const received = capture<TestRunDetail>(row, 'app-test-stop', () =>
        shadow(row, STOP_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.uid).toBe(step.uid)
    })

    it('drops the rerun button from a failed row that cannot be run', async () => {
      const row = await mountRow(
        rowProps(mixedStateRun.failing, { runDisabled: true })
      )

      expect(shadowAll(row, RERUN_BUTTON)).toHaveLength(0)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(1)
    })
  })

  describe('collapsing', () => {
    it('hides the chevron on a row without children', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      expect(row.hasChildren).toBe(false)
      expect(shadow(row, CHEVRON_BUTTON)?.classList.contains('hidden')).toBe(
        true
      )
    })

    it('offers no collapse control on a row without children', async () => {
      const row = await mountRow(rowProps(mixedStateRun.passing))

      expect(shadowAll(row, TOOLBAR_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(0)
      expect(shadowAll(row, COLLAPSE_ALL_ICON)).toHaveLength(0)
    })

    it('shows the chevron and a collapse control on a row with children', async () => {
      // A suite fragment with tests derives both `hasChildren` and its passed
      // state, so the row under test is the one the explorer would render.
      const row = await mountRow(rowProps(profileSuite))

      expect(row.hasChildren).toBe(true)
      expect(row.state).toBe('passed')
      expect(shadow(row, CHEVRON_BUTTON)?.classList.contains('hidden')).toBe(
        false
      )
      expect(shadowAll(row, TOOLBAR_BUTTON)).toHaveLength(2)
      // The row starts out rendering its children, so the control it offers is
      // the one that collapses them.
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)
      expect(shadowAll(row, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(0)
    })

    it('hides the children from the toolbar collapse control too', async () => {
      const row = await mountRow(rowProps(profileSuite))

      shadow(row, COLLAPSE_ALL_ICON)?.click()
      await settle(row)

      expect(childrenSection(row)?.classList.contains('hidden')).toBe(true)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(1)
    })

    it('collapses the children section when the chevron is clicked', async () => {
      const row = await mountRow(rowProps(profileSuite))
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(row.isCollapsed).toBe(true)
      // Reflected, so a tree-wide control can read the row's state off the DOM.
      expect(row.hasAttribute('is-collapsed')).toBe(true)
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(true)
    })

    it('rotates the chevron while collapsed', async () => {
      const row = await mountRow(rowProps(profileSuite))
      expect(shadow(row, CHEVRON)?.classList.contains('-rotate-90')).toBe(false)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(shadow(row, CHEVRON)?.classList.contains('-rotate-90')).toBe(true)
    })

    it('expands the children section again on a second click', async () => {
      const row = await mountRow(rowProps(profileSuite))

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)
      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(row.isCollapsed).toBe(false)
      expect(row.hasAttribute('is-collapsed')).toBe(false)
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)
    })

    it('reports the new collapsed state on entry-collapse-change', async () => {
      const row = await mountRow(rowProps(profileSuite))

      const received = capture<{ isCollapsed: boolean; entry: Element }>(
        row,
        'entry-collapse-change',
        () => shadow(row, CHEVRON_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.isCollapsed).toBe(true)
      expect(received[0]?.detail.entry).toBe(row)
    })

    it('keeps entry-collapse-change inside the tree that owns the row', async () => {
      const row = await mountRow(rowProps(profileSuite))

      const received = capture<{ isCollapsed: boolean }>(
        row,
        'entry-collapse-change',
        () => shadow(row, CHEVRON_BUTTON)?.click()
      )

      // Not composed: the explorer listens on its own shadow root, so the event
      // must stop at the boundary rather than escaping to the document.
      expect(received[0]?.bubbles).toBe(true)
      expect(received[0]?.composed).toBe(false)
    })

    it('tracks the children with the toolbar control through a collapse and back', async () => {
      const row = await mountRow(rowProps(profileSuite))

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      // Children hidden, so the control on offer is the one that shows them.
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(true)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(row, COLLAPSE_ALL_ICON)).toHaveLength(0)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)
      expect(shadowAll(row, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(0)
    })
  })
})
