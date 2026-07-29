import '@components/sidebar/test-suite.js'
import type { ExplorerTestEntry } from '@components/sidebar/test-suite.js'
import type { TestRunDetail } from '@components/sidebar/types.js'

import { mount, settle } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import {
  CALL_SOURCE,
  entryProps,
  mixedStateRun,
  SPEC_FILE,
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

async function mountRow(
  props: TestEntryProps = {},
  label = mixedStateRun.passing.title
): Promise<ExplorerTestEntry> {
  const row = await mount<ExplorerTestEntry>(TAG, entryProps(props))
  const title = document.createElement('label')
  title.slot = 'label'
  title.textContent = label
  row.append(title)
  await settle(row)
  return row
}

function capture<T>(
  target: EventTarget,
  type: string,
  act: () => void
): CustomEvent<T>[] {
  const received: CustomEvent<T>[] = []
  const listener = (event: Event) => received.push(event as CustomEvent<T>)
  target.addEventListener(type, listener)
  try {
    act()
  } finally {
    target.removeEventListener(type, listener)
  }
  return received
}

describe('wdio-test-entry', () => {
  describe('state icon', () => {
    it('shows a check for a passing test', async () => {
      const row = await mountRow({ state: 'passed' })

      expect(shadowAll(row, PASSED_ICON)).toHaveLength(1)
      expect(
        shadow(row, PASSED_ICON)?.classList.contains('text-chartsGreen')
      ).toBe(true)
    })

    it('shows a cross for a failing test', async () => {
      const row = await mountRow({ state: 'failed' })

      expect(shadowAll(row, FAILED_ICON)).toHaveLength(1)
      expect(
        shadow(row, FAILED_ICON)?.classList.contains('text-chartsRed')
      ).toBe(true)
    })

    it('shows a step-over arrow for a skipped test', async () => {
      const row = await mountRow({ state: 'skipped' })

      expect(shadowAll(row, SKIPPED_ICON)).toHaveLength(1)
      expect(
        shadow(row, SKIPPED_ICON)?.classList.contains('text-chartsYellow')
      ).toBe(true)
    })

    it('shows a pulsing dot instead of an icon while a test runs', async () => {
      const row = await mountRow({ state: 'running' })

      expect(shadowAll(row, RUNNING_DOT)).toHaveLength(1)
      expect(shadowAll(row, PASSED_ICON)).toHaveLength(0)
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(0)
    })

    it('shows an empty circle for a test that is only pending', async () => {
      const row = await mountRow({ state: 'pending' })

      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
      expect(
        shadow(row, NOT_RUN_ICON)?.classList.contains('text-disabledForeground')
      ).toBe(true)
    })

    it('shows an empty circle for a test with no state at all', async () => {
      const row = await mountRow({ state: undefined })

      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
    })

    it('shows an empty circle for a state it does not recognise', async () => {
      const row = await mountRow({ state: 'passed' })

      // Set through the attribute because that is how the explorer feeds state,
      // and it keeps an off-contract value out of the typed property.
      row.setAttribute('state', 'aborted')
      await settle(row)

      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(1)
      expect(shadowAll(row, PASSED_ICON)).toHaveLength(0)
    })

    it('swaps the icon when the state changes', async () => {
      const row = await mountRow({ state: 'running' })

      row.state = 'failed'
      await settle(row)

      expect(shadowAll(row, RUNNING_DOT)).toHaveLength(0)
      expect(shadowAll(row, FAILED_ICON)).toHaveLength(1)
    })

    it('leaves the state icon off a root row', async () => {
      const row = await mountRow({ state: 'failed', root: true })

      expect(row.hasAttribute('root')).toBe(true)
      expect(shadowAll(row, FAILED_ICON)).toHaveLength(0)
      expect(shadowAll(row, NOT_RUN_ICON)).toHaveLength(0)
    })
  })

  describe('title', () => {
    it('renders the title projected into the label slot', async () => {
      const row = await mountRow({}, mixedStateRun.failing.title)

      const slot = shadow<HTMLSlotElement>(row, LABEL_SLOT)
      expect(slot?.assignedElements().map((el) => text(el))).toEqual([
        mixedStateRun.failing.title
      ])
    })
  })

  describe('selection', () => {
    it('announces its uid on app-test-select when the row is clicked', async () => {
      const row = await mountRow({ uid: mixedStateRun.failing.uid })

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
      const row = await mountRow({ uid: undefined })

      const received = capture<string>(row, 'app-test-select', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(0)
    })

    it('asks the source view on window to highlight its call site', async () => {
      const row = await mountRow({ callSource: CALL_SOURCE })

      const received = capture<string>(window, 'app-source-highlight', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toBe(CALL_SOURCE)
    })

    it('leaves the source view alone when the row has no call site', async () => {
      const row = await mountRow({ callSource: undefined })

      const received = capture<string>(window, 'app-source-highlight', () =>
        shadow(row, LABEL_SPAN)?.click()
      )

      expect(received).toHaveLength(0)
    })

    it('reflects the selected flag so the row can be styled', async () => {
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
      const row = await mountRow({ state: 'passed' })

      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(1)
      expect(shadow(row, RUN_BUTTON)?.getAttribute('title')).toBe(
        'Run this entry'
      )
      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(0)
    })

    it('replaces the run button with a stop button while the row runs', async () => {
      const row = await mountRow({ state: 'running' })

      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
      expect(shadowAll(row, RERUN_BUTTON)).toHaveLength(0)
    })

    it('offers a preserve-and-rerun button only after a failure', async () => {
      const failed = await mountRow({ state: 'failed' })
      const passed = await mountRow({ state: 'passed' })

      expect(shadowAll(failed, RERUN_BUTTON)).toHaveLength(1)
      expect(shadowAll(passed, RERUN_BUTTON)).toHaveLength(0)
    })

    it('emits app-test-run carrying the row identity', async () => {
      const row = await mountRow({
        uid: mixedStateRun.failing.uid,
        labelText: mixedStateRun.failing.title,
        fullTitle: mixedStateRun.failing.fullTitle,
        state: 'failed',
        featureFile: 'checkout.feature',
        featureLine: 12,
        suiteType: 'scenario'
      })

      const received = capture<TestRunDetail>(row, 'app-test-run', () =>
        shadow(row, RUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({
        uid: mixedStateRun.failing.uid,
        entryType: 'test',
        specFile: SPEC_FILE,
        fullTitle: mixedStateRun.failing.fullTitle,
        label: mixedStateRun.failing.title,
        callSource: CALL_SOURCE,
        featureFile: 'checkout.feature',
        featureLine: 12,
        suiteType: 'scenario'
      })
      expect(received[0]?.composed).toBe(true)
    })

    it('emits app-test-stop for the running row without the feature fields', async () => {
      const row = await mountRow({
        uid: mixedStateRun.running.uid,
        labelText: mixedStateRun.running.title,
        fullTitle: mixedStateRun.running.fullTitle,
        state: 'running',
        featureFile: 'checkout.feature',
        featureLine: 12
      })

      const received = capture<TestRunDetail>(row, 'app-test-stop', () =>
        shadow(row, STOP_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toEqual({
        uid: mixedStateRun.running.uid,
        entryType: 'test',
        specFile: SPEC_FILE,
        fullTitle: mixedStateRun.running.fullTitle,
        label: mixedStateRun.running.title,
        callSource: CALL_SOURCE
      })
    })

    it('emits app-test-preserve-rerun for the failed row', async () => {
      const row = await mountRow({
        uid: mixedStateRun.failing.uid,
        state: 'failed',
        suiteType: 'scenario'
      })

      const received = capture<TestRunDetail>(
        row,
        'app-test-preserve-rerun',
        () => shadow(row, RERUN_BUTTON)?.click()
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.detail.uid).toBe(mixedStateRun.failing.uid)
      expect(received[0]?.detail.suiteType).toBe('scenario')
      expect(received[0]?.composed).toBe(true)
    })

    it('disables the run button and explains why when running is not supported', async () => {
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

    it('offers no stop button on a running row that cannot be stopped', async () => {
      const row = await mountRow({ state: 'running', runDisabled: true })

      expect(shadowAll(row, STOP_BUTTON)).toHaveLength(0)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(0)
    })

    it('drops the rerun button from a failed row that cannot be run', async () => {
      const row = await mountRow({ state: 'failed', runDisabled: true })

      expect(shadowAll(row, RERUN_BUTTON)).toHaveLength(0)
      expect(shadowAll(row, RUN_BUTTON)).toHaveLength(1)
    })
  })

  describe('collapsing', () => {
    it('hides the chevron on a row without children', async () => {
      const row = await mountRow({ hasChildren: false })

      expect(shadow(row, CHEVRON_BUTTON)?.classList.contains('hidden')).toBe(
        true
      )
    })

    it('offers no collapse control on a row without children', async () => {
      const row = await mountRow({ hasChildren: false, state: 'passed' })

      expect(shadowAll(row, TOOLBAR_BUTTON)).toHaveLength(1)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(0)
    })

    it('shows the chevron and a collapse control on a row with children', async () => {
      const row = await mountRow({ hasChildren: true, state: 'passed' })

      expect(shadow(row, CHEVRON_BUTTON)?.classList.contains('hidden')).toBe(
        false
      )
      expect(shadowAll(row, TOOLBAR_BUTTON)).toHaveLength(2)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(1)
    })

    it('collapses the children section when the chevron is clicked', async () => {
      const row = await mountRow({ hasChildren: true })
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(row.getAttribute('is-collapsed')).toBe('true')
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(true)
    })

    it('rotates the chevron while collapsed', async () => {
      const row = await mountRow({ hasChildren: true })
      expect(shadow(row, CHEVRON)?.classList.contains('-rotate-90')).toBe(false)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(shadow(row, CHEVRON)?.classList.contains('-rotate-90')).toBe(true)
    })

    it('expands the children section again on a second click', async () => {
      const row = await mountRow({ hasChildren: true })

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)
      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(row.getAttribute('is-collapsed')).toBe('false')
      expect(childrenSection(row)?.classList.contains('hidden')).toBe(false)
    })

    it('reports the new collapsed state on entry-collapse-change', async () => {
      const row = await mountRow({ hasChildren: true })

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
      const row = await mountRow({ hasChildren: true })

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

    it('switches the toolbar control to collapse-all once the row has been expanded', async () => {
      const row = await mountRow({ hasChildren: true })
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(1)

      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)
      shadow(row, CHEVRON_BUTTON)?.click()
      await settle(row)

      expect(shadowAll(row, COLLAPSE_ALL_ICON)).toHaveLength(1)
      expect(shadowAll(row, EXPAND_ALL_ICON)).toHaveLength(0)
    })
  })
})
